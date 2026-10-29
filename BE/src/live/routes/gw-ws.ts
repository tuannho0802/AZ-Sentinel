import { looksLikeGwToken, type TunnelDirectoryReply, tunnelWsUrl } from '@az-sentinel/shared'
import { type Context, Hono } from 'hono'
import { sharedOriginStore, type VpsOriginStore } from '../../edge/vps-origin'
import { AppError } from '../../lib/app-error'
import { sha256Hex } from '../../lib/crypto'
import { bearerToken } from '../../lib/service-auth'
import { nowUnix } from '../../lib/time'
import {
  findActiveTokenByHash,
  type GwTokenRow,
  touchTokenUsed,
} from '../../services/gw-token-service'
import type { AppEnv } from '../../types'
import { encodeGwToken, GW_HEADER, GW_TOKEN_HEADER } from '../gw-header'
import { VIEWER_HEADER } from '../viewer-header'
import { HUB_NAME } from './live-ws'

/**
 * Xác thực mức kết nối của Gateway (Plan 4): token cá nhân `azt_...` do quản trị viên cấp, mỗi token
 * chỉ thuộc một người. Kiểm hình dạng trước (request lạ không tốn truy vấn), rồi tra băm trong D1
 * (1 dòng đọc). Token sai, đã thu hồi hoặc đã đặt lại đều 401 và không bao giờ tới hub.
 */
async function authenticateGatewayToken(c: Context<AppEnv>): Promise<GwTokenRow> {
  const given = bearerToken(c.req.header('Authorization'))
  if (!looksLikeGwToken(given)) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Token Gateway không hợp lệ')
  }
  const row = await findActiveTokenByHash(c.env.DB, await sha256Hex(given))
  if (!row)
    throw new AppError(401, 'UNAUTHENTICATED', 'Token Gateway không hợp lệ hoặc đã bị thu hồi')
  return row
}

/**
 * - `GET /api/gw/check`: bộ cài/Gateway hỏi nhanh token còn dùng được không (200 hoặc 401).
 * - `GET /api/gw/tunnel` (Plan 3H): danh bạ tunnel. Gateway có token hỏi địa chỉ Quick Tunnel hiện tại của VPS rồi nối
 *   thẳng vào đó. Chỉ 1 lần đọc D1 (token) cộng đọc đệm địa chỉ; không chuyển tiếp gì sang VPS.
 * - `GET /api/gw/ws`: Gateway giữ một WebSocket tới đây (Plan 3C mục 4). Mức kết nối dùng token cá
 *   nhân; quyền dữ liệu từng liên kết vẫn đi qua khóa trong tin `bind`, hub kiểm lại bằng D1 và đòi
 *   liên kết phải thuộc chủ của token. Trình duyệt luôn gửi `Origin`; Gateway thì không.
 */
export function createGwWsRoutes(origins: VpsOriginStore = sharedOriginStore) {
  const routes = new Hono<AppEnv>()

  routes.get('/check', async (c) => {
    const row = await authenticateGatewayToken(c)
    c.header('Cache-Control', 'no-store')
    return c.json({ ok: true, owner_id: row.owner_id })
  })

  routes.get('/tunnel', async (c) => {
    await authenticateGatewayToken(c)
    const origin = await origins.resolve(c.env)
    const body: TunnelDirectoryReply = {
      ok: true,
      origin,
      wsUrl: origin ? tunnelWsUrl(origin) : null,
    }
    c.header('Cache-Control', 'no-store')
    return c.json(body)
  })

  routes.get('/ws', async (c) => {
    if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') {
      throw new AppError(400, 'VALIDATION_FAILED', 'Cần kết nối WebSocket')
    }
    if (c.req.header('Origin')) {
      throw new AppError(403, 'FORBIDDEN', 'Nguồn kết nối không được phép')
    }
    const token = await authenticateGatewayToken(c)
    try {
      await touchTokenUsed(c.env.DB, token, nowUnix())
    } catch {
      // last_used_at chỉ để hiển thị; lỗi ghi không chặn kết nối
    }
    const headers = new Headers(c.req.raw.headers)
    headers.delete('Authorization')
    headers.delete(VIEWER_HEADER)
    headers.set(GW_HEADER, '1')
    headers.set(GW_TOKEN_HEADER, encodeGwToken(token.id, token.owner_id))
    try {
      const stub = c.env.LIVE_HUB.getByName(HUB_NAME)
      return await stub.fetch(new Request(c.req.url, { method: 'GET', headers }))
    } catch {
      throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Dịch vụ tạm thời không khả dụng')
    }
  })

  return routes
}
