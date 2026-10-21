import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/app'

const app = createApp()
const TOKEN = 'bi-mat-chung-cua-gateway-0123456789'

function connect(headers: Record<string, string>, extra: Record<string, string> = {}) {
  return app.fetch(
    new Request('http://az.test/api/gw/ws', { headers: { Upgrade: 'websocket', ...headers } }),
    { DB: env.DB, LIVE_HUB: env.LIVE_HUB, ...extra },
  )
}

describe('/api/gw/ws: token mức kết nối (Plan 3D)', () => {
  it('đã đặt token: thiếu hoặc sai token thì 401, không tới hub', async () => {
    expect((await connect({}, { GW_CONNECT_TOKEN: TOKEN })).status).toBe(401)
    expect(
      (await connect({ Authorization: 'Bearer sai' }, { GW_CONNECT_TOKEN: TOKEN })).status,
    ).toBe(401)
    expect((await connect({ Authorization: TOKEN }, { GW_CONNECT_TOKEN: TOKEN })).status).toBe(401)
  })

  it('đúng token: nâng cấp WebSocket thành công', async () => {
    const res = await connect({ Authorization: `Bearer ${TOKEN}` }, { GW_CONNECT_TOKEN: TOKEN })
    expect(res.status).toBe(101)
    res.webSocket?.accept()
    res.webSocket?.close(1000)
  })

  it('chưa đặt token và không chạy dev: 503 (an toàn mặc định)', async () => {
    expect((await connect({})).status).toBe(503)
  })

  it('chưa đặt token nhưng chạy dev (DEV_LINKS_API=1): cho qua như trước', async () => {
    const res = await connect({}, { DEV_LINKS_API: '1' })
    expect(res.status).toBe(101)
    res.webSocket?.accept()
    res.webSocket?.close(1000)
  })

  it('có Origin (trình duyệt) vẫn bị 403 dù đúng token', async () => {
    const res = await connect(
      { Authorization: `Bearer ${TOKEN}`, Origin: 'https://evil.example' },
      { GW_CONNECT_TOKEN: TOKEN },
    )
    expect(res.status).toBe(403)
  })
})
