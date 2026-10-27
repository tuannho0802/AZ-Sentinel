import {
  DEVICE_COOKIE,
  DEVICE_HANDOFF_PARAM,
  deviceCookieHeader,
  isRawDeviceId,
  PAGE_STAY_PARAM,
} from '@az-sentinel/shared'
import type { Handler } from 'hono'
import { notFound } from '../middleware/error-handler'
import type { AppEnv } from '../types'
import { sealDeviceHandoff } from './device-handoff'
import type { FetchFn } from './timed-fetch'
import { sharedOriginStore, type VpsOriginStore } from './vps-origin'
import { type ProbeRegistry, probeFor } from './vps-probe'

export type PageRouterOptions = {
  /** Chỉ để kiểm thử: thay `fetch` ra ngoài và sổ đăng ký trạng thái dò. */
  fetchFn?: FetchFn
  registry?: ProbeRegistry
  /** Chỉ để kiểm thử: nơi nhớ địa chỉ tunnel VPS báo lên. */
  origins?: VpsOriginStore
}

/** Lượt tải trang của trình duyệt (không phải fetch/ảnh/script): đây là thứ đáng chuyển hướng. */
export function isPageNavigation(req: Request): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false
  const dest = req.headers.get('Sec-Fetch-Dest')
  if (dest) return dest === 'document'
  return (req.headers.get('Accept') ?? '').includes('text/html')
}

function cookieValue(header: string | null, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=')
    if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return undefined
}

/** 32 ký tự base64url (192 bit ngẫu nhiên), hợp lệ với `isRawDeviceId`. */
function mintDeviceId(): string {
  const b = crypto.getRandomValues(new Uint8Array(24))
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Plan 3K: giữ mã thiết bị ổn định qua các lần tunnel đổi địa chỉ. Worker có địa chỉ cố định nên là nơi giữ cookie
 * thiết bị của trình duyệt (cấp mới nếu chưa có); đi kèm mỗi lần chuyển hướng là một vé mã hóa ngắn hạn để Server
 * cấp lại cùng mã đó cho địa chỉ tunnel hiện tại. Không có `SYNC_TOKEN` thì không có khóa chung: chuyển hướng như cũ.
 */
async function withDeviceHandoff(
  target: string,
  req: Request,
  secret: string | undefined,
): Promise<{ location: string; setCookie: string | null }> {
  if (!secret) return { location: target, setCookie: null }
  const existing = cookieValue(req.headers.get('Cookie'), DEVICE_COOKIE)
  const raw = isRawDeviceId(existing) ? existing : mintDeviceId()
  const url = new URL(target)
  url.searchParams.set(
    DEVICE_HANDOFF_PARAM,
    await sealDeviceHandoff(secret, raw, Math.floor(Date.now() / 1000)),
  )
  return {
    location: url.toString(),
    setCookie: raw === existing ? null : deviceCookieHeader(raw, true),
  }
}

/**
 * Địa chỉ Worker nên chuyển hướng tới, hoặc null nếu phải tự phục vụ giao diện.
 * Mặc định chỉ chuyển sang Quick Tunnel mà VPS đã báo lên; `VPS_ORIGIN` đặt tay chỉ khi `PAGE_REDIRECT=1`.
 */
async function redirectOrigin(
  env: AppEnv['Bindings'],
  origins: VpsOriginStore,
): Promise<string | null> {
  if (env.PAGE_REDIRECT === '0') return null
  const learned = await origins.learned(env)
  if (learned) return learned
  return env.PAGE_REDIRECT === '1' ? await origins.resolve(env) : null
}

/**
 * Plan 3J: Worker là "người đi tìm tunnel", không phải máy chủ giao diện.
 * - Lượt tải trang + VPS (tunnel) đang sống: 302 sang tunnel, giữ nguyên đường dẫn. Từ đó mọi request của người dùng
 *   đi thẳng vào VPS, Worker chỉ tốn đúng một request cho mỗi lượt vào.
 * - Tunnel chết, chưa biết tunnel, hoặc có `?az_stay=1`: phục vụ giao diện dự phòng từ static assets.
 * Tunnel đổi địa chỉ thì VPS báo lại cho Worker nên lượt vào sau luôn trỏ đúng; địa chỉ chết không bao giờ được trả cho
 * trình duyệt vì luôn dò (có nhớ tạm vài giây) trước khi chuyển hướng.
 */
export function createPageHandler(opts: PageRouterOptions = {}): Handler<AppEnv> {
  const origins = opts.origins ?? sharedOriginStore
  return async (c) => {
    const url = new URL(c.req.url)
    // Đường /api không khớp route nào: giữ nguyên 404 JSON như trước.
    if (
      url.pathname === '/api' ||
      url.pathname.startsWith('/api/') ||
      c.env.HOST ||
      !c.env.ASSETS
    ) {
      return notFound(c)
    }
    const req = c.req.raw
    const stay = url.searchParams.get(PAGE_STAY_PARAM) === '1'
    if (!stay && isPageNavigation(req)) {
      const origin = await redirectOrigin(c.env, origins)
      // Trùng host với chính Worker (cấu hình sai) thì không chuyển, tránh vòng lặp.
      if (origin && new URL(origin).host !== url.host) {
        if (await probeFor(origin, opts.registry, opts.fetchFn).isUp()) {
          const next = await withDeviceHandoff(
            `${origin}${url.pathname}${url.search}`,
            req,
            c.env.SYNC_TOKEN,
          )
          const headers = new Headers({
            Location: next.location,
            'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer',
          })
          if (next.setCookie) headers.append('Set-Cookie', next.setCookie)
          return new Response(null, { status: 302, headers })
        }
      }
    }
    return c.env.ASSETS.fetch(req)
  }
}
