import {
  createDeviceRuleRequestSchema,
  DEVICE_ID_HEADER,
  type DeviceGuardState,
  type DeviceRule,
  isHashedDeviceId,
  setDeviceGuardRequestSchema,
  updateDeviceRuleRequestSchema,
} from '@az-sentinel/shared'
import { zValidator } from '@hono/zod-validator'
import { type Context, Hono } from 'hono'
import { AppError, errorBody } from '../lib/app-error'
import { nowUnix } from '../lib/time'
import type { Viewer, ViewerAuth } from '../live/viewer-auth'
import {
  createDevice,
  deleteDevice,
  deviceAllowed,
  dismissPending,
  getDevice,
  isDeviceEnforced,
  listDevices,
  listPending,
  setDeviceEnforced,
  updateDevice,
} from '../services/device-rules-service'
import { allowedBy, isEnforced, listRules } from '../services/ip-rules-service'
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

/** Mã thiết bị (đã băm) mà Server đặt vào request; null khi không qua Server VPS (gọi thẳng máy Server, Cloudflare). */
const yourDevice = (c: Context<AppEnv>): string | null => {
  const v = c.req.header(DEVICE_ID_HEADER)?.trim().toLowerCase()
  return isHashedDeviceId(v) ? v : null
}

const yourIp = (c: Context<AppEnv>): string | null =>
  c.req.header('CF-Connecting-IP')?.trim() || null

const bad = (message: string) => (result: { success: boolean }, c: Context) => {
  if (!result.success) return c.json(errorBody('VALIDATION_FAILED', message), 400)
}

async function stateOf(c: Context<AppEnv>): Promise<DeviceGuardState> {
  const id = yourDevice(c)
  const [enforce, rules, pending] = await Promise.all([
    isDeviceEnforced(c.env.DB),
    listDevices(c.env.DB),
    listPending(c.env.DB),
  ])
  return {
    enforce,
    your_device_id: id,
    your_device_allowed: deviceAllowed(rules, id),
    rules,
    pending,
  }
}

/**
 * Whitelist THIẾT BỊ, CHỈ quản trị viên (đi cùng whitelist IP).
 * - `GET /`: công tắc, mã thiết bị của bạn, danh sách thiết bị, thiết bị lạ vừa bị chặn.
 * - `POST /`: duyệt một thiết bị (`mode`: `any_ip` = IP nào thiết bị vào thì duyệt IP đó luôn; `device_only` = chỉ
 *   duyệt thiết bị, IP vẫn do quản trị viên duyệt). `PATCH /:id` đổi nhãn/chế độ, `DELETE /:id` gỡ thiết bị (và
 *   các IP thiết bị đó đã tự thêm), `DELETE /pending/:deviceId` bỏ qua một thiết bị chờ duyệt.
 * - `PUT /guard`: bật/tắt "chỉ thiết bị trong danh sách mới vào được". Bật khi thiết bị của chính bạn chưa được
 *   duyệt bị từ chối để không tự khóa mình; gỡ thiết bị của bạn lúc đang bật cũng bị từ chối.
 * Ghi bắt buộc JSON; phản hồi `no-store`. (Việc chặn thật chạy ở Server VPS, Cloudflare dự phòng không chặn.)
 */
export function createAdminDeviceRoutes(viewerAuth: ViewerAuth) {
  const routes = new Hono<AppEnv>()

  routes.use('*', async (c, next) => {
    const viewer = await viewerAuth(c)
    if (!viewer) throw new AppError(401, 'UNAUTHENTICATED', 'Chưa đăng nhập')
    if (viewer.role !== 'admin' && viewer.role !== 'root_admin') {
      throw new AppError(403, 'FORBIDDEN', 'Chỉ quản trị viên được quản lý whitelist thiết bị')
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
    zValidator('json', createDeviceRuleRequestSchema, bad('Mã thiết bị không hợp lệ')),
    async (c) => {
      const body = c.req.valid('json')
      const rule = await createDevice(c.env.DB, body, actorOf(c).userId, nowUnix())
      if (!rule) throw new AppError(409, 'CONFLICT', 'Thiết bị này đã có trong danh sách')
      return c.json({ rule } satisfies { rule: DeviceRule }, 201)
    },
  )

  routes.patch(
    '/:id',
    zValidator('json', updateDeviceRuleRequestSchema, bad('Dữ liệu không hợp lệ')),
    async (c) => {
      const rule = await updateDevice(c.env.DB, parseId(c.req.param('id')), c.req.valid('json'))
      if (!rule) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy thiết bị')
      return c.json({ rule } satisfies { rule: DeviceRule })
    },
  )

  routes.delete('/pending/:deviceId', async (c) => {
    const deviceId = c.req.param('deviceId').toLowerCase()
    if (!isHashedDeviceId(deviceId)) {
      throw new AppError(400, 'VALIDATION_FAILED', 'Mã thiết bị không hợp lệ')
    }
    if (!(await dismissPending(c.env.DB, deviceId))) {
      throw new AppError(404, 'NOT_FOUND', 'Không có thiết bị chờ duyệt này')
    }
    return c.body(null, 204)
  })

  routes.delete('/:id', async (c) => {
    const device = await getDevice(c.env.DB, parseId(c.req.param('id')))
    if (!device) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy thiết bị')
    if (yourDevice(c) === device.device_id && (await isDeviceEnforced(c.env.DB))) {
      throw new AppError(409, 'CONFLICT', 'Đây là thiết bị của bạn; gỡ sẽ tự khóa bạn ra ngoài')
    }
    // Gỡ thiết bị cũng gỡ các IP nó tự thêm: không để mất quyền vào của chính IP bạn đang dùng khi whitelist IP bật.
    const ip = yourIp(c)
    if (ip !== null && (await isEnforced(c.env.DB))) {
      const rules = await listRules(c.env.DB)
      const rest = rules.filter((r) => r.device_id !== device.device_id)
      if (allowedBy(rules, ip) && !allowedBy(rest, ip)) {
        throw new AppError(
          409,
          'CONFLICT',
          'IP của bạn đang được phép nhờ thiết bị này; gỡ sẽ tự khóa bạn ra ngoài',
        )
      }
    }
    await deleteDevice(c.env.DB, device)
    return c.body(null, 204)
  })

  routes.put(
    '/guard',
    zValidator('json', setDeviceGuardRequestSchema, bad('Dữ liệu không hợp lệ')),
    async (c) => {
      const { enforce } = c.req.valid('json')
      if (enforce && !deviceAllowed(await listDevices(c.env.DB), yourDevice(c))) {
        throw new AppError(
          409,
          'CONFLICT',
          'Hãy duyệt thiết bị của bạn trước khi bật, kẻo tự khóa mình ra ngoài',
        )
      }
      await setDeviceEnforced(c.env.DB, enforce, nowUnix())
      return c.json(await stateOf(c))
    },
  )

  return routes
}
