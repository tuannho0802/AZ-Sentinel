import { Hono } from 'hono'
import { z } from 'zod'
import { findLinkOwner } from '../../db/sql'
import { AppError } from '../../lib/app-error'
import type { AppEnv } from '../../types'
import { GW_HEADER } from '../gw-header'
import type { LiveScope } from '../hub-types'
import { isOriginAllowed } from '../origin'
import { resolveViewer, type Viewer, type ViewerAuth } from '../viewer-auth'
import { encodeViewer, VIEWER_HEADER } from '../viewer-header'

/** Một Durable Object toàn cục đủ cho khoảng 30 EA (Plan 3B mục 13). */
export const HUB_NAME = 'global'

const scopeQuerySchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('links') }),
  z.object({ scope: z.literal('link'), id: z.coerce.number().int().positive() }),
])

const isAdmin = (v: Viewer) => v.role === 'root_admin' || v.role === 'admin'

/**
 * Phạm vi xem do SERVER quyết định (Rules BE mục 4): admin xem rộng, User chỉ xem liên kết của
 * mình. Không dựa vào `hello` của trình duyệt. Liên kết không tồn tại hoặc không thuộc quyền xem
 * đều trả 404, không phân biệt (Rules BE mục 3).
 */
async function resolveScope(
  db: D1Database,
  viewer: Viewer,
  query: z.infer<typeof scopeQuerySchema>,
): Promise<LiveScope> {
  if (query.scope === 'links') {
    return isAdmin(viewer) ? { kind: 'all' } : { kind: 'owner', ownerId: viewer.userId }
  }
  const row = await findLinkOwner(db, query.id)
  if (!row || (!isAdmin(viewer) && row.owner_id !== viewer.userId)) {
    throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy liên kết')
  }
  return { kind: 'link', linkId: query.id }
}

/** `GET /api/live/ws`: mở kết nối tức là đang xem; đóng kết nối tức là thôi xem. */
export function createLiveWsRoutes(auth: ViewerAuth = resolveViewer) {
  const routes = new Hono<AppEnv>()

  routes.get('/ws', async (c) => {
    if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') {
      throw new AppError(400, 'VALIDATION_FAILED', 'Cần kết nối WebSocket')
    }
    const allowed = isOriginAllowed({
      origin: c.req.header('Origin'),
      requestHost: new URL(c.req.url).host,
      allowedCsv: c.env.LIVE_ALLOWED_ORIGINS,
      dev: c.env.DEV_LINKS_API === '1',
    })
    if (!allowed) throw new AppError(403, 'FORBIDDEN', 'Nguồn kết nối không được phép')

    const viewer = await auth(c)
    if (!viewer) throw new AppError(401, 'UNAUTHENTICATED', 'Chưa đăng nhập')

    const query = scopeQuerySchema.safeParse({ scope: c.req.query('scope'), id: c.req.query('id') })
    if (!query.success) throw new AppError(400, 'VALIDATION_FAILED', 'Phạm vi xem không hợp lệ')
    const scope = await resolveScope(c.env.DB, viewer, query.data)

    const headers = new Headers(c.req.raw.headers)
    // Header nội bộ do hub tin: không bao giờ lấy từ client (xóa GW_HEADER, ghi đè VIEWER_HEADER).
    headers.delete(GW_HEADER)
    headers.set(
      VIEWER_HEADER,
      encodeViewer({
        userId: viewer.userId,
        role: viewer.role,
        scope,
        expiresAt: viewer.expiresAt,
        nowMs: Date.now(),
      }),
    )
    try {
      const stub = c.env.LIVE_HUB.getByName(HUB_NAME)
      return await stub.fetch(new Request(c.req.url, { method: 'GET', headers }))
    } catch {
      throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Dịch vụ tạm thời không khả dụng')
    }
  })

  return routes
}
