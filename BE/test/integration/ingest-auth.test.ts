import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import { count, LOGIN, makePayload, post, resetDb, SERVER, seedLink } from '../helpers'

beforeEach(resetDb)

const withAccount = (over: Record<string, unknown>) => {
  const p = makePayload()
  return { ...p, account: { ...p.account, ...over } }
}

describe('ingest: trạng thái liên kết và gắn tài khoản', () => {
  it('liên kết bị khóa trả 403 LINK_DISABLED và không ghi gì', async () => {
    const { key } = await seedLink({ status: 'disabled' })
    const res = await post(key, makePayload())
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: { code: 'LINK_DISABLED' } })
    expect(await count('link_state')).toBe(0)
  })

  it('(server, login) lệch trả 409 và ghi sự kiện auth_fail', async () => {
    const { key, id } = await seedLink()
    const res = await post(key, withAccount({ login: LOGIN + 1 }))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: { code: 'LINK_BOUND_TO_OTHER_ACCOUNT' } })
    expect(await count('link_state')).toBe(0)
    expect(await count('events', `link_id = ${id} AND type = 'auth_fail'`)).toBe(1)
  })

  it('server lệch (cùng login) cũng trả 409', async () => {
    const { key } = await seedLink()
    const res = await post(key, withAccount({ server: 'Other-Server' }))
    expect(res.status).toBe(409)
  })

  it('auth_fail bị giới hạn tần suất: lỗi lặp lại chỉ ghi một sự kiện', async () => {
    const { key, id } = await seedLink()
    for (let i = 0; i < 5; i++) await post(key, withAccount({ login: LOGIN + 1 }))
    expect(await count('events', `link_id = ${id} AND type = 'auth_fail'`)).toBe(1)
  })

  it('sự kiện auth_fail không chứa API key', async () => {
    const { key } = await seedLink()
    await post(key, withAccount({ login: LOGIN + 1 }))
    const row = await env.DB.prepare('SELECT detail_json FROM events').first<{
      detail_json: string
    }>()
    expect(row?.detail_json).not.toContain(key)
  })

  it('lần ingest đầu gắn khóa với (server, login) và lưu thông tin tài khoản', async () => {
    const { key, id } = await seedLink({ bound: false })
    const res = await post(key, makePayload())
    expect(res.status).toBe(200)
    const link = await env.DB.prepare(
      'SELECT login, server, broker, currency, bound_at FROM ea_links WHERE id = ?',
    )
      .bind(id)
      .first<{
        login: number
        server: string
        broker: string
        currency: string
        bound_at: number
      }>()
    expect(link).toMatchObject({
      login: LOGIN,
      server: SERVER,
      broker: 'Broker Ltd',
      currency: 'USD',
    })
    expect(link?.bound_at).toBeGreaterThan(0)
  })

  it('sau khi đã gắn, đổi sang tài khoản khác bị 409', async () => {
    const { key } = await seedLink({ bound: false })
    expect((await post(key, makePayload())).status).toBe(200)
    expect((await post(key, withAccount({ login: LOGIN + 5 }))).status).toBe(409)
  })

  it('hai khóa không thể cùng gắn một (server, login): khóa thứ hai nhận 409', async () => {
    const a = await seedLink({ bound: false })
    const b = await seedLink({ bound: false })
    expect((await post(a.key, makePayload())).status).toBe(200)
    const res = await post(b.key, makePayload())
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: { code: 'LINK_BOUND_TO_OTHER_ACCOUNT' } })
    // Batch nguyên tử: khóa B không để lại dữ liệu nửa vời.
    expect(await count('link_state', `link_id = ${b.id}`)).toBe(0)
    const link = await env.DB.prepare('SELECT login FROM ea_links WHERE id = ?')
      .bind(b.id)
      .first<{ login: number | null }>()
    expect(link?.login).toBeNull()
  })
})
