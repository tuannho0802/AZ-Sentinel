import { FAILOVER } from '@az-sentinel/shared'
import type { MiddlewareHandler } from 'hono'
import { AppError } from '../lib/app-error'
import type { AppEnv } from '../types'
import { type FetchFn, realFetch, timedFetch } from './timed-fetch'
import { normalizeOrigin, type ProbeRegistry, probeFor, type VpsProbe } from './vps-probe'

/** Route luôn do chính Worker xử lý, kể cả khi VPS sống (chúng tự ghép thông tin hai phía). */
const LOCAL_ONLY = ['/api/server-info', '/api/sync']

/** Mã của tunnel/proxy khi VPS không với tới được: coi như VPS sập. */
const UPSTREAM_DOWN = new Set([502, 503, 504, 521, 522, 523, 524, 530])

export type EdgeRouterOptions = {
  /** Chỉ để kiểm thử: thay `fetch` ra ngoài và sổ đăng ký trạng thái dò. */
  fetchFn?: FetchFn
  registry?: ProbeRegistry
}

const isLocalOnly = (path: string) =>
  LOCAL_ONLY.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))

/**
 * Bộ định tuyến biên (Plan 3E). Khi `VPS_ORIGIN` được cấu hình:
 * - VPS sống: chuyển tiếp nguyên request (kể cả nâng cấp WebSocket) sang VPS; Worker không đụng D1 hay
 *   Durable Object nên không tốn hạn mức.
 * - VPS sập hoặc chuyển tiếp lỗi: tự xử lý bằng hub và D1 của Cloudflare (chế độ dự phòng). Request
 *   đọc và WebSocket được thử lại ngay ở Cloudflare; request ghi (POST/DELETE...) không thử lại để
 *   không ghi hai lần ở hai nơi, client nhận 502 một lần rồi các request sau đi dự phòng.
 */
export function createEdgeRouter(opts: EdgeRouterOptions = {}): MiddlewareHandler<AppEnv> {
  const fetchFn = opts.fetchFn ?? realFetch
  return async (c, next) => {
    // Đang chạy trên chính VPS (Node): không chuyển tiếp đi đâu.
    if (c.env.HOST) {
      c.set('servedBy', c.env.HOST.role)
      c.set('mode', 'primary')
      return next()
    }
    const origin = normalizeOrigin(c.env.VPS_ORIGIN)
    if (!origin) {
      c.set('mode', 'standalone')
      return next()
    }
    const path = c.req.path
    if (isLocalOnly(path)) return next()

    const probe = probeFor(origin, opts.registry, fetchFn)
    if (await probe.isUp()) {
      const res = await forward(c.req.raw, origin, probe, fetchFn)
      if (res) {
        c.set('servedBy', 'vps')
        c.set('mode', 'primary')
        return res
      }
      if (!isSafeToRetry(c.req.raw)) {
        throw new AppError(502, 'UPSTREAM_FAILED', 'Máy chủ chính vừa mất kết nối, hãy thử lại')
      }
    }

    c.set('mode', 'fallback')
    const writing = c.req.method !== 'GET' && c.req.method !== 'HEAD'
    const guarded = path.startsWith('/api/dev/') || path.startsWith('/api/admin/')
    if (writing && guarded && c.env.FALLBACK_WRITABLE !== '1') {
      throw new AppError(
        503,
        'READ_ONLY_FALLBACK',
        'Đang chạy dự phòng trên Cloudflare: tạm thời chỉ cho xem, chưa cho đổi liên kết hay token',
      )
    }
    return next()
  }
}

function isSafeToRetry(req: Request): boolean {
  return (
    req.method === 'GET' ||
    req.method === 'HEAD' ||
    req.headers.get('Upgrade')?.toLowerCase() === 'websocket'
  )
}

/** Chuyển tiếp sang VPS. Trả null khi VPS không với tới được (đã đánh dấu sập). */
async function forward(
  req: Request,
  origin: string,
  probe: VpsProbe,
  fetchFn: FetchFn,
): Promise<Response | null> {
  const url = new URL(req.url)
  const headers = new Headers(req.headers)
  headers.delete('Host')
  // VPS không thấy IP và host thật của người dùng, nên Worker chuyển lại bằng header riêng.
  const ip = req.headers.get('CF-Connecting-IP')
  if (ip) headers.set('X-AZ-Client-IP', ip)
  headers.set('X-Forwarded-Host', url.host)
  headers.set('X-Forwarded-Proto', url.protocol.replace(':', ''))
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
  try {
    const res = await timedFetch(
      fetchFn,
      `${origin}${url.pathname}${url.search}`,
      {
        method: req.method,
        headers,
        body: hasBody ? req.clone().body : undefined,
        redirect: 'manual',
      },
      FAILOVER.proxyTimeoutMs,
    )
    if (UPSTREAM_DOWN.has(res.status)) {
      await res.body?.cancel()
      probe.markDown()
      return null
    }
    return res
  } catch {
    probe.markDown()
    return null
  }
}
