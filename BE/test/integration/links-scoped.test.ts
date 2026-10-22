import { env } from 'cloudflare:workers'
import type { CreateLinkResponse, LinkListResponse } from '@az-sentinel/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app'
import { resetDb, seedLink, seedUser, TEST_PASSWORD } from '../helpers'

const app = createApp()
const bindings = { DB: env.DB, LIVE_HUB: env.LIVE_HUB }

function call(method: string, path: string, cookie: string | null, body?: unknown) {
  return app.fetch(
    new Request(`http://az.test/api${path}`, {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    bindings,
  )
}

async function loginAs(email: string): Promise<string> {
  const res = await call('POST', '/auth/login', null, { email, password: TEST_PASSWORD })
  expect(res.status).toBe(200)
  return (res.headers.get('Set-Cookie') ?? '').split(';')[0] ?? ''
}

const create = async (cookie: string) =>
  (await (await call('POST', '/links', cookie, {})).json<CreateLinkResponse>()).link

beforeEach(resetDb)

describe('/api/links có phân quyền (Plan 4B)', () => {
  it('chưa đăng nhập 401', async () => {
    expect((await call('GET', '/links', null)).status).toBe(401)
    expect((await call('POST', '/links', null, {})).status).toBe(401)
  })

  it('người dùng chỉ thấy liên kết của mình; admin thấy tất cả kèm chủ sở hữu', async () => {
    await seedUser('root@az.test', { role: 'root_admin', name: 'Gốc' })
    await seedUser('a@az.test', { name: 'An' })
    await seedUser('b@az.test', { name: 'Bình' })
    const [root, a, b] = [
      await loginAs('root@az.test'),
      await loginAs('a@az.test'),
      await loginAs('b@az.test'),
    ]
    const la = await create(a)
    await create(b)

    const mine = await (await call('GET', '/links', a)).json<LinkListResponse>()
    expect(mine.links.map((l) => l.id)).toEqual([la.id])
    expect(mine.links[0]?.owner?.name).toBe('An')

    const all = await (await call('GET', '/links', root)).json<LinkListResponse>()
    expect(all.links).toHaveLength(2)
    expect(all.links.map((l) => l.owner?.name).sort()).toEqual(['An', 'Bình'])
  })

  it('xem hoặc sửa liên kết của người khác đều 404; liên kết chưa gắn chủ chỉ admin thấy', async () => {
    await seedUser('root@az.test', { role: 'root_admin' })
    await seedUser('a@az.test')
    await seedUser('b@az.test')
    const [root, a, b] = [
      await loginAs('root@az.test'),
      await loginAs('a@az.test'),
      await loginAs('b@az.test'),
    ]
    const la = await create(a)
    expect((await call('GET', `/links/${la.id}`, b)).status).toBe(404)
    expect((await call('POST', `/links/${la.id}/status`, b, { status: 'disabled' })).status).toBe(
      404,
    )
    expect((await call('POST', `/links/${la.id}/rotate-key`, b, {})).status).toBe(404)
    expect((await call('DELETE', `/links/${la.id}`, b)).status).toBe(404)
    expect((await call('GET', `/links/${la.id}`, a)).status).toBe(200)
    expect((await call('GET', `/links/${la.id}`, root)).status).toBe(200)

    const orphan = await seedLink()
    expect((await call('GET', `/links/${orphan.id}`, a)).status).toBe(404)
    expect((await call('GET', `/links/${orphan.id}`, root)).status).toBe(200)
  })

  it('tạo liên kết gắn chủ là người tạo, khóa chỉ hiện một lần; xóa của mình được', async () => {
    await seedUser('a@az.test')
    const a = await loginAs('a@az.test')
    const res = await call('POST', '/links', a, { vps_name: 'A9' })
    expect(res.status).toBe(201)
    const body = await res.json<CreateLinkResponse>()
    expect(body.api_key.length).toBeGreaterThan(20)
    expect(body.link.vps_name).toBe('A9')
    const row = await env.DB.prepare('SELECT owner_id FROM ea_links WHERE id = ?')
      .bind(body.link.id)
      .first<{ owner_id: number }>()
    expect(row?.owner_id).toBeGreaterThan(0)
    expect(JSON.stringify(await (await call('GET', '/links', a)).json())).not.toContain(
      body.api_key,
    )
    expect((await call('DELETE', `/links/${body.link.id}`, a)).status).toBe(204)
  })

  it('giới hạn số liên kết của người dùng thường', async () => {
    await seedUser('a@az.test')
    const a = await loginAs('a@az.test')
    for (let i = 0; i < 20; i++) expect((await call('POST', '/links', a, {})).status).toBe(201)
    expect((await call('POST', '/links', a, {})).status).toBe(400)
  })

  it('ghi bắt buộc JSON', async () => {
    await seedUser('a@az.test')
    const a = await loginAs('a@az.test')
    const res = await app.fetch(
      new Request('http://az.test/api/links', {
        method: 'POST',
        headers: { Cookie: a, 'Content-Type': 'text/plain' },
        body: '{}',
      }),
      bindings,
    )
    expect(res.status).toBe(400)
  })
})
