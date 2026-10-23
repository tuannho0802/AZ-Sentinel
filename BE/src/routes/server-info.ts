import { FAILOVER, USER_ROLES, type UserRole } from '@az-sentinel/shared'
import { type Context, Hono } from 'hono'
import { applyEdgeClientIp } from '../edge/edge-sign'
import { realFetch, timedFetch } from '../edge/timed-fetch'
import { sharedOriginStore } from '../edge/vps-origin'
import { AppError } from '../lib/app-error'
import { requireServiceToken } from '../lib/service-auth'
import { nowUnix } from '../lib/time'
import type { Viewer, ViewerAuth } from '../live/viewer-auth'
import { buildServerInfo, describeSelf, type ServerInfoDeps } from '../services/server-info-service'
import type { AppEnv } from '../types'

/**
 * `GET /api/server-info`: máy chủ nào đang phục vụ, VPS chính còn sống không, đồng bộ ra sao. Chỉ
 * người xem đã đăng nhập mới đọc được (tên máy, hệ điều hành, tải CPU/RAM không nên công khai).
 * `GET /api/server-info/self`: Worker hỏi VPS bằng token dịch vụ `SYNC_TOKEN`, chỉ trả thông tin của chính node.
 */
export function createServerInfoRoutes(auth: ViewerAuth, deps: ServerInfoDeps = {}) {
  const routes = new Hono<AppEnv>()

  /**
   * Khi VPS là máy chủ chính, phiên đăng nhập nằm trong CSDL của VPS, còn `/api/server-info` luôn do Worker tự xử lý
   * (xem LOCAL_ONLY) và chỉ tra D1 của Worker, nên người đã đăng nhập qua VPS vẫn bị 401. Cookie không khớp ở D1 của
   * Worker thì hỏi VPS (`/api/me`, kèm IP thật có chữ ký để không vướng whitelist IP) xem phiên có hợp lệ không.
   */
  const viewerViaVps = async (c: Context<AppEnv>): Promise<Viewer | null> => {
    const cookie = c.req.header('Cookie')
    if (c.env.HOST || !cookie) return null
    try {
      const origin = await (deps.origins ?? sharedOriginStore).resolve(c.env)
      if (!origin) return null
      const headers = new Headers({ Cookie: cookie })
      await applyEdgeClientIp(
        headers,
        c.req.header('CF-Connecting-IP') ?? null,
        c.env.SYNC_TOKEN,
        nowUnix(),
      )
      const res = await timedFetch(
        deps.fetchFn ?? realFetch,
        `${origin}/api/me`,
        { headers },
        FAILOVER.probeTimeoutMs,
      )
      if (!res.ok) {
        await res.body?.cancel()
        return null
      }
      const me = (await res.json()) as { id?: unknown; role?: unknown }
      const role = USER_ROLES.find((r) => r === me.role)
      if (typeof me.id !== 'number' || !role) return null
      return { userId: me.id, role: role satisfies UserRole, expiresAt: null }
    } catch {
      return null
    }
  }

  routes.get('/', async (c) => {
    const viewer = (await auth(c)) ?? (await viewerViaVps(c))
    if (!viewer) throw new AppError(401, 'UNAUTHENTICATED', 'Chưa đăng nhập')
    const info = await buildServerInfo(c, deps)
    c.set('servedBy', info.active.role)
    c.set('mode', info.mode)
    c.header('Cache-Control', 'no-store')
    return c.json(info)
  })

  routes.get('/self', async (c) => {
    await requireServiceToken(c, c.env.SYNC_TOKEN, {
      missing: 'Chưa cấu hình SYNC_TOKEN',
      invalid: 'Token dịch vụ không hợp lệ',
    })
    c.header('Cache-Control', 'no-store')
    return c.json(await describeSelf(c))
  })

  return routes
}
