import {
  createGwTokenRequestSchema,
  type GwTokenListResponse,
  type GwTokenSecretResponse,
} from '@az-sentinel/shared'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { AppError, errorBody } from '../lib/app-error'
import { nowUnix } from '../lib/time'
import { HUB_NAME } from '../live/routes/live-ws'
import type { ViewerAuth } from '../live/viewer-auth'
import {
  createToken,
  type GwTokenRow,
  listTokens,
  resetToken,
  revokeToken,
  toSummary,
} from '../services/gw-token-service'
import { getUserById } from '../services/user-service'
import type { AppEnv, Bindings } from '../types'

/** Báo hub đá Gateway đang dùng token vừa đổi/thu hồi. Hub lỗi không chặn thao tác (token đã chết ở D1). */
export async function dropTokenAtHub(env: Bindings, row: GwTokenRow): Promise<void> {
  try {
    await env.LIVE_HUB.getByName(HUB_NAME).dropToken(row.id)
  } catch {
    // Gateway sẽ bị từ chối ở lần nối lại kế tiếp
  }
}

const parseId = (raw: string): number => {
  const id = Number(raw)
  if (!Number.isInteger(id) || id <= 0)
    throw new AppError(400, 'VALIDATION_FAILED', 'id không hợp lệ')
  return id
}

/**
 * Quản lý token Gateway (Plan 4), CHỈ quản trị viên (`admin`, `root_admin`):
 * - `GET /`: danh sách (không có token thô).
 * - `POST /`: cấp token cho một người. Token thô chỉ có trong phản hồi này.
 * - `POST /:id/reset`: đặt lại, token cũ chết ngay và Gateway đang dùng nó bị ngắt.
 * - `POST /:id/revoke`: thu hồi vĩnh viễn (muốn dùng lại thì cấp token mới).
 * Xác thực qua `viewerAuth` (cùng cơ chế người xem WebSocket). Ghi bắt buộc JSON để trang web lạ
 * không kích hoạt được qua form. Đáp `no-store` vì phản hồi có thể chứa token.
 */
export function createAdminTokenRoutes(viewerAuth: ViewerAuth) {
  const routes = new Hono<AppEnv>()

  routes.use('*', async (c, next) => {
    const viewer = await viewerAuth(c)
    if (!viewer) throw new AppError(401, 'UNAUTHENTICATED', 'Chưa đăng nhập')
    if (viewer.role !== 'admin' && viewer.role !== 'root_admin') {
      throw new AppError(403, 'FORBIDDEN', 'Chỉ quản trị viên được quản lý token')
    }
    const method = c.req.method
    if (method !== 'GET' && method !== 'HEAD') {
      const type = c.req.header('Content-Type') ?? ''
      if (!type.toLowerCase().includes('application/json')) {
        throw new AppError(400, 'VALIDATION_FAILED', 'Cần Content-Type: application/json')
      }
    }
    c.header('Cache-Control', 'no-store')
    await next()
  })

  routes.get('/', async (c) => {
    const rows = await listTokens(c.env.DB)
    return c.json({ tokens: rows.map(toSummary) } satisfies GwTokenListResponse)
  })

  routes.post(
    '/',
    zValidator('json', createGwTokenRequestSchema, (result, c) => {
      if (!result.success) {
        return c.json(errorBody('VALIDATION_FAILED', 'Dữ liệu không hợp lệ'), 400)
      }
    }),
    async (c) => {
      const body = c.req.valid('json')
      // Chỉ cấp cho người dùng có thật và đang hoạt động; nhãn mặc định là tên người đó.
      const owner = await getUserById(c.env.DB, body.owner_id)
      if (!owner) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy người dùng')
      if (owner.status !== 'active') {
        throw new AppError(409, 'CONFLICT', 'Người dùng chưa được duyệt hoặc đã bị khóa')
      }
      const { token, row } = await createToken(
        c.env.DB,
        { ownerId: owner.id, label: (body.label ?? owner.display_name).slice(0, 64) },
        nowUnix(),
      )
      return c.json({ token, summary: toSummary(row) } satisfies GwTokenSecretResponse, 201)
    },
  )

  routes.post('/:id/reset', async (c) => {
    const out = await resetToken(c.env.DB, parseId(c.req.param('id')))
    if (!out) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy token')
    await dropTokenAtHub(c.env, out.row)
    return c.json({ token: out.token, summary: toSummary(out.row) } satisfies GwTokenSecretResponse)
  })

  routes.post('/:id/revoke', async (c) => {
    const row = await revokeToken(c.env.DB, parseId(c.req.param('id')), nowUnix())
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy token')
    await dropTokenAtHub(c.env, row)
    return c.json({ summary: toSummary(row) })
  })

  return routes
}
