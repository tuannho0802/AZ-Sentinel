import { env } from 'cloudflare:workers'
import { SERVED_BY_HEADER } from '@az-sentinel/shared'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/app'
import type { FetchFn } from '../../src/edge/timed-fetch'

const ORIGIN = 'https://vps.test'

/**
 * Tái hiện lỗi "trang kẹt ở Đang kiểm tra phiên đăng nhập": lần dò `/api/health` đầu tiên không bao giờ kết
 * thúc (giả lập request sở hữu lần dò bị hủy giữa chừng nên promise không còn được giải quyết, kể cả hạn
 * dò 2,5 giây). Mọi request sau dùng chung promise đó nên phải được trả lời trong thời gian hữu hạn.
 */
describe('lần dò VPS bị treo không được làm kẹt các request sau', () => {
  it('request đồng thời và request sau vẫn được trả lời (rơi về dự phòng) thay vì chờ mãi', async () => {
    let probes = 0
    const fetchFn: FetchFn = (input) => {
      if (new URL(input).pathname === '/api/health') {
        probes++
        return new Promise<Response>(() => {}) // không bao giờ kết thúc, bỏ qua cả tín hiệu hủy
      }
      return Promise.resolve(
        Response.json({ from: 'vps' }, { headers: { [SERVED_BY_HEADER]: 'vps' } }),
      )
    }
    const app = createApp({ edge: { fetchFn, registry: new Map() } })
    const e = {
      DB: env.DB,
      LIVE_HUB: env.LIVE_HUB,
      VPS_ORIGIN: ORIGIN,
      SYNC_TOKEN: 'sync-token-0123456789',
    }
    const ask = () => app.fetch(new Request('http://az.test/api/health'), e)

    const first = ask()
    const second = ask() // tab thứ hai mở trang lúc lần dò đầu còn đang treo
    const [a, b] = await Promise.all([first, second])
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)

    // Lần dò treo đã bị bỏ: request tới sau đó phải tự dò lại (không nằm chờ promise cũ) và cũng trả lời được.
    const third = await ask()
    expect(third.status).toBe(200)
    expect(probes).toBeGreaterThanOrEqual(1)
  }, 15_000)
})
