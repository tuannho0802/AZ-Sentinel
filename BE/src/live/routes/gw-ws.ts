import { Hono } from 'hono'
import { AppError } from '../../lib/app-error'
import type { AppEnv } from '../../types'
import { GW_HEADER } from '../gw-header'
import { VIEWER_HEADER } from '../viewer-header'
import { HUB_NAME } from './live-ws'

/**
 * `GET /api/gw/ws`: Gateway của VPS giữ một WebSocket tới đây (Plan 3C mục 4). Không có xác thực
 * mức kết nối ở MVP (Q3): mọi quyền đi qua khóa của từng liên kết trong tin `bind`, hub kiểm lại
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
    const headers = new Headers(c.req.raw.headers)
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
