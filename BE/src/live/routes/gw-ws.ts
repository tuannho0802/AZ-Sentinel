import { type Context, Hono } from 'hono'
import { AppError } from '../../lib/app-error'
import { sha256Hex } from '../../lib/crypto'
import type { AppEnv } from '../../types'
import { GW_HEADER } from '../gw-header'
import { VIEWER_HEADER } from '../viewer-header'
import { HUB_NAME } from './live-ws'

/**
 * Xác thực mức kết nối của Gateway (Plan 3D): bí mật chung `GW_CONNECT_TOKEN`. Quyền xem dữ liệu
 * của từng liên kết vẫn đi qua khóa trong tin `bind`; token này chỉ để request lạ (bot, quét cổng)
 * không đánh thức hub và không tốn request Durable Object. So sánh bằng băm để không lộ độ dài/khớp
 * từng ký tự.
 */
async function checkGatewayToken(c: Context<AppEnv>): Promise<void> {
  const expected = c.env.GW_CONNECT_TOKEN
  if (!expected) {
    if (c.env.DEV_LINKS_API === '1') return
    throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Chưa cấu hình GW_CONNECT_TOKEN')
  }
  const header = c.req.header('Authorization') ?? ''
  const given = header.startsWith('Bearer ') ? header.slice(7) : ''
  const [a, b] = await Promise.all([sha256Hex(given), sha256Hex(expected)])
  if (a !== b) throw new AppError(401, 'UNAUTHENTICATED', 'Token Gateway không hợp lệ')
}

/**
 * `GET /api/gw/ws`: Gateway của VPS giữ một WebSocket tới đây (Plan 3C mục 4). Mức kết nối dùng
 * `GW_CONNECT_TOKEN`; mọi quyền dữ liệu đi qua khóa của từng liên kết trong tin `bind`, hub kiểm lại
 * bằng D1. Trình duyệt luôn gửi `Origin`; Gateway thì không, nên có `Origin` là bị từ chối.
 */
export function createGwWsRoutes() {
  const routes = new Hono<AppEnv>()

  routes.get('/ws', async (c) => {
    if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') {
      throw new AppError(400, 'VALIDATION_FAILED', 'Cần kết nối WebSocket')
    }
    if (c.req.header('Origin')) {
      throw new AppError(403, 'FORBIDDEN', 'Nguồn kết nối không được phép')
    }
    await checkGatewayToken(c)
    const headers = new Headers(c.req.raw.headers)
    headers.delete('Authorization')
    headers.delete(VIEWER_HEADER)
    headers.set(GW_HEADER, '1')
    try {
      const stub = c.env.LIVE_HUB.getByName(HUB_NAME)
      return await stub.fetch(new Request(c.req.url, { method: 'GET', headers }))
    } catch {
      throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Dịch vụ tạm thời không khả dụng')
    }
  })

  return routes
}
