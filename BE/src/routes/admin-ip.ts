import {
  createIpRuleRequestSchema,
  type IpGuardState,
  type IpRule,
  setIpGuardRequestSchema,
  updateIpRuleRequestSchema,
} from '@az-sentinel/shared'
import { zValidator } from '@hono/zod-validator'
import { type Context, Hono } from 'hono'
import { AppError, errorBody } from '../lib/app-error'
import { nowUnix } from '../lib/time'
import type { Viewer, ViewerAuth } from '../live/viewer-auth'
import {
  allowedBy,
  createRule,
  deleteRule,
  isEnforced,
  listBlocked,
  listRules,
  setEnforced,
  updateRule,
} from '../services/ip-rules-service'
import type { AppEnv } from '../types'

const parseId = (raw: string): number => {
  const id = Number(raw)
  if (!Number.isInteger(id) || id <= 0) {
    throw new AppError(400, 'VALIDATION_FAILED', 'id không hợp lệ')
  }
  return id
}

const actorOf = (c: Context<AppEnv>): Viewer => {
  const viewer = c.get('viewer')
  if (!viewer) throw new AppError(401, 'UNAUTHENTICATED', 'Chưa đăng nhập')
  return viewer
}

/** IP Server thấy ở request này (Server đặt từ Cloudflare Tunnel hoặc từ socket); null nếu không có. */
const yourIp = (c: Context<AppEnv>): string | null =>
  c.req.header('CF-Connecting-IP')?.trim() || null

const bad = (message: string) => (result: { success: boolean }, c: Context) => {
  if (!result.success) return c.json(errorBody('VALIDATION_FAILED', message), 400)
}

async function stateOf(c: Context<AppEnv>): Promise<IpGuardState> {
  const ip = yourIp(c)
  const [enforce, rules, blocked] = await Promise.all([
    isEnforced(c.env.DB),
    listRules(c.env.DB),
    listBlocked(c.env.DB),
  ])
  return { enforce, your_ip: ip, your_ip_allowed: allowedBy(rules, ip), rules, blocked }
}

/**
 * Whitelist IP (Plan 3F), CHỈ quản trị viên. Server VPS đọc bảng `ip_rules` để quyết định cho IP nào vào.
 * - `GET /`: công tắc, IP của bạn, danh sách luật, IP bị chặn gần đây.
 * - `POST /`: thêm luật (IP hoặc dải CIDR, nhãn, số kết nối tối đa). `PATCH /:id`, `DELETE /:id`.
 * - `PUT /guard`: bật/tắt "chỉ IP trong danh sách". Bật khi IP của chính bạn chưa nằm trong danh sách bị
 *   từ chối để không tự khóa mình; xóa luật cuối cùng cho IP của bạn lúc đang bật cũng bị từ chối.
 * Ghi bắt buộc JSON; phản hồi `no-store`. (Việc chặn thật chạy ở Server VPS, Cloudflare dự phòng không chặn.)
 */
export function createAdminIpRoutes(viewerAuth: ViewerAuth) {
  const routes = new Hono<AppEnv>()

  routes.use('*', async (c, next) => {
    const viewer = await viewerAuth(c)
    if (!viewer) throw new AppError(401, 'UNAUTHENTICATED', 'Chưa đăng nhập')
    if (viewer.role !== 'admin' && viewer.role !== 'root_admin') {
      throw new AppError(403, 'FORBIDDEN', 'Chỉ quản trị viên được quản lý whitelist IP')
    }
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      const type = c.req.header('Content-Type') ?? ''
      if (!type.toLowerCase().includes('application/json')) {
        throw new AppError(400, 'VALIDATION_FAILED', 'Cần Content-Type: application/json')
      }
    }
    c.set('viewer', viewer)
    c.header('Cache-Control', 'no-store')
    await next()
  })

  routes.get('/', async (c) => c.json(await stateOf(c)))

  routes.post(
    '/',
    zValidator(
      'json',
      createIpRuleRequestSchema,
      bad('IP hoặc dải CIDR không hợp lệ (ví dụ 1.2.3.4 hoặc 1.2.3.0/24)'),
    ),
    async (c) => {
      const body = c.req.valid('json')
      const rule = await createRule(c.env.DB, body, actorOf(c).userId, nowUnix())
      if (!rule) throw new AppError(409, 'CONFLICT', 'IP này đã có trong danh sách')
      return c.json({ rule } satisfies { rule: IpRule }, 201)
    },
  )

  routes.patch(
    '/:id',
    zValidator('json', updateIpRuleRequestSchema, bad('Dữ liệu không hợp lệ')),
    async (c) => {
      const rule = await updateRule(c.env.DB, parseId(c.req.param('id')), c.req.valid('json'))
      if (!rule) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy luật')
      return c.json({ rule } satisfies { rule: IpRule })
    },
  )

  routes.delete('/:id', async (c) => {
    const id = parseId(c.req.param('id'))
    const [enforce, rules] = await Promise.all([isEnforced(c.env.DB), listRules(c.env.DB)])
    if (enforce && !allowedBy(rules, yourIp(c), id) && allowedBy(rules, yourIp(c))) {
      throw new AppError(
        409,
        'CONFLICT',
        'Đây là luật duy nhất cho IP của bạn; xóa sẽ tự khóa bạn ra ngoài',
      )
    }
    if (!(await deleteRule(c.env.DB, id)))
      throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy luật')
    return c.body(null, 204)
  })

  routes.put(
    '/guard',
    zValidator('json', setIpGuardRequestSchema, bad('Dữ liệu không hợp lệ')),
    async (c) => {
      const { enforce } = c.req.valid('json')
      if (enforce && !allowedBy(await listRules(c.env.DB), yourIp(c))) {
        throw new AppError(
          409,
          'CONFLICT',
          'Hãy thêm IP của bạn vào danh sách trước khi bật, kẻo tự khóa mình ra ngoài',
        )
      }
      await setEnforced(c.env.DB, enforce, nowUnix())
      return c.json(await stateOf(c))
    },
  )

  return routes
}
