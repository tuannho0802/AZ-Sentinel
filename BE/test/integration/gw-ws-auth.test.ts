import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app'
import { revokeToken } from '../../src/services/gw-token-service'
import { resetDb, seedToken } from '../helpers'

const app = createApp()

function call(path: string, headers: Record<string, string>, extra: Record<string, string> = {}) {
  return app.fetch(new Request(`http://az.test${path}`, { headers }), {
    DB: env.DB,
    LIVE_HUB: env.LIVE_HUB,
    ...extra,
  })
}
const connect = (headers: Record<string, string>) =>
  call('/api/gw/ws', { Upgrade: 'websocket', ...headers })
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` })

beforeEach(resetDb)

describe('/api/gw/ws: token cá nhân của Gateway (Plan 4)', () => {
  it('thiếu token, sai hình dạng hoặc token lạ thì 401, không tới hub', async () => {
    expect((await connect({})).status).toBe(401)
    expect((await connect(bearer('sai'))).status).toBe(401)
    expect((await connect(bearer('azt_khong-ton-tai-0123456789abcdef'))).status).toBe(401)
  })

  it('token hợp lệ: nâng cấp WebSocket thành công, ghi last_used_at', async () => {
    const { token, id } = await seedToken(7)
    const res = await connect(bearer(token))
    expect(res.status).toBe(101)
    res.webSocket?.accept()
    res.webSocket?.close(1000)
    const row = await env.DB.prepare('SELECT last_used_at FROM gw_tokens WHERE id = ?')
      .bind(id)
      .first<{ last_used_at: number | null }>()
    expect(row?.last_used_at).not.toBeNull()
  })

  it('token đã thu hồi thì 401', async () => {
    const { token, id } = await seedToken(7)
    await revokeToken(env.DB, id, 2_000)
    expect((await connect(bearer(token))).status).toBe(401)
  })

  it('có Origin (trình duyệt) vẫn bị 403 dù đúng token', async () => {
    const { token } = await seedToken(7)
    expect((await connect({ ...bearer(token), Origin: 'https://evil.example' })).status).toBe(403)
  })

  it('/api/gw/check: 200 cho token hợp lệ, 401 cho token sai hoặc đã thu hồi', async () => {
    const { token, id } = await seedToken(7)
    expect((await call('/api/gw/check', bearer(token))).status).toBe(200)
    expect((await call('/api/gw/check', bearer('azt_khong-ton-tai-0123456789abcdef'))).status).toBe(
      401,
    )
    await revokeToken(env.DB, id, 2_000)
    expect((await call('/api/gw/check', bearer(token))).status).toBe(401)
  })
})
