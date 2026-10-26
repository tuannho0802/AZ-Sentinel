import {
  ALERT,
  type AlertSettings,
  alertSettingsSchema,
  bpToPct,
  markReadRequestSchema,
  pctToBp,
} from '@az-sentinel/shared'
import { type Context, Hono } from 'hono'
import { AppError } from '../lib/app-error'
import { nowUnix } from '../lib/time'
import { HUB_NAME } from '../live/routes/live-ws'
import type { Viewer, ViewerAuth } from '../live/viewer-auth'
import {
  listNotifications,
  loadAlertBp,
  markRead,
  saveAlertBp,
  unreadCount,
} from '../services/alert-service'
import type { AppEnv, Bindings } from '../types'

const viewerOf = (c: Context<AppEnv>): Viewer => {
  const viewer = c.get('viewer')
  if (!viewer) throw new AppError(401, 'UNAUTHENTICATED', 'Chưa đăng nhập')
  return viewer
}

/** Báo ngay cho Gateway của người này (nếu đang nối) ngưỡng mới. Hub không sẵn sàng: Gateway nhận ở lần nối lại. */
async function pushCfgToHub(env: Bindings, ownerId: number, bp: number): Promise<void> {
  try {
    await env.LIVE_HUB.getByName(HUB_NAME).setAlertCfg(ownerId, bp)
  } catch {
    // Gateway sẽ nhận lúc `hello` kế tiếp
  }
}

function guard(viewerAuth: ViewerAuth) {
  return async (c: Context<AppEnv>, next: () => Promise<void>) => {
    const viewer = await viewerAuth(c)
    if (!viewer) throw new AppError(401, 'UNAUTHENTICATED', 'Chưa đăng nhập')
    const method = c.req.method
    if (method !== 'GET' && method !== 'HEAD') {
      const type = c.req.header('Content-Type') ?? ''
      if (!type.toLowerCase().includes('application/json')) {
        throw new AppError(400, 'VALIDATION_FAILED', 'Cần Content-Type: application/json')
      }
    }
    c.set('viewer', viewer)
    c.header('Cache-Control', 'no-store')
    await next()
  }
}

/**
 * Thông báo của chính người đăng nhập (kể cả admin: chỉ thấy thông báo của tài khoản mình sở hữu).
 * - `GET /` danh sách mới nhất kèm số chưa đọc. `?unread=1` chỉ lấy chưa đọc; `?limit=` tối đa `ALERT.listLimit`.
 * - `POST /read` đánh dấu đã đọc: `{ "all": true }` hoặc `{ "ids": ["..."] }`.
 */
export function createNotificationRoutes(viewerAuth: ViewerAuth) {
  const routes = new Hono<AppEnv>()
  routes.use('*', guard(viewerAuth))

  routes.get('/', async (c) => {
    const viewer = viewerOf(c)
    const raw = Number(c.req.query('limit') ?? 30)
    const limit = Number.isInteger(raw) ? Math.min(ALERT.listLimit, Math.max(1, raw)) : 30
    return c.json(
      await listNotifications(c.env.DB, viewer.userId, {
        limit,
        unreadOnly: c.req.query('unread') === '1',
      }),
    )
  })

  routes.post('/read', async (c) => {
    const viewer = viewerOf(c)
    const parsed = markReadRequestSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) throw new AppError(400, 'VALIDATION_FAILED', 'Dữ liệu không hợp lệ')
    await markRead(c.env.DB, viewer.userId, parsed.data, nowUnix())
    return c.json({ unread: await unreadCount(c.env.DB, viewer.userId) })
  })

  return routes
}

/**
 * Cài đặt cảnh báo lỗ float của chính người đăng nhập. `loss_pct` = 0 tắt cảnh báo. Đổi xong, Gateway của người
 * này nhận ngưỡng mới ngay và chuyển cho EA ở lần ping kế tiếp (tối đa vài giây).
 */
export function createAlertSettingsRoutes(viewerAuth: ViewerAuth) {
  const routes = new Hono<AppEnv>()
  routes.use('*', guard(viewerAuth))

  routes.get('/', async (c) => {
    const viewer = viewerOf(c)
    const body: AlertSettings = {
      loss_pct: bpToPct(await loadAlertBp(c.env.DB, viewer.userId)),
    }
    return c.json(body)
  })

  routes.put('/', async (c) => {
    const viewer = viewerOf(c)
    const parsed = alertSettingsSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      throw new AppError(
        400,
        'VALIDATION_FAILED',
        parsed.error.issues[0]?.message ?? 'Ngưỡng cảnh báo không hợp lệ',
      )
    }
    const bp = pctToBp(parsed.data.loss_pct)
    await saveAlertBp(c.env.DB, viewer.userId, bp, nowUnix())
    await pushCfgToHub(c.env, viewer.userId, bp)
    const body: AlertSettings = { loss_pct: bpToPct(bp) }
    return c.json(body)
  })

  return routes
}
