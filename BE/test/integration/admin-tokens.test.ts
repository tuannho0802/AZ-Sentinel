import { env } from 'cloudflare:workers'
import type { GwTokenSecretResponse } from '@az-sentinel/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app'
import { resetDb, seedUser } from '../helpers'

const app = createApp()
const ADMIN = { Cookie: 'az_mock_session=admin@az.local' }
const USER = { Cookie: 'az_mock_session=user@az.local' }
const env2 = { DB: env.DB, LIVE_HUB: env.LIVE_HUB, DEV_LINKS_API: '1' }

function api(method: string, path: string, headers: Record<string, string>, body?: unknown) {
  return app.fetch(
    new Request(`http://az.test/api/admin/gw-tokens${path}`, {
      method,
      headers: {
        ...headers,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env2,
  )
}

beforeEach(resetDb)

describe('/api/admin/gw-tokens (Plan 4)', () => {
  it('chưa đăng nhập 401, người dùng thường 403', async () => {
    expect((await api('GET', '', {})).status).toBe(401)
    expect((await api('GET', '', USER)).status).toBe(403)
    expect((await api('POST', '', USER, { owner_id: 2, label: 'x' })).status).toBe(403)
  })

  it('cấp, liệt kê (không lộ token thô), cấp trùng 409', async () => {
    const an = await seedUser('an@az.test', { name: 'An' })
    const created = await api('POST', '', ADMIN, { owner_id: an.id, label: 'An' })
    expect(created.status).toBe(201)
    const body = await created.json<GwTokenSecretResponse>()
    expect(body.token.startsWith('azt_')).toBe(true)
    const list = await (await api('GET', '', ADMIN)).text()
    expect(list).not.toContain(body.token)
    expect(list).toContain(body.summary.prefix)
    expect((await api('POST', '', ADMIN, { owner_id: an.id, label: 'An' })).status).toBe(409)
  })

  it('chỉ cấp cho người dùng có thật và đang hoạt động; nhãn mặc định là tên người đó', async () => {
    expect((await api('POST', '', ADMIN, { owner_id: 4242 })).status).toBe(404)
    const cho = await seedUser('cho@az.test', { status: 'pending' })
    expect((await api('POST', '', ADMIN, { owner_id: cho.id })).status).toBe(409)
    const binh = await seedUser('binh@az.test', { name: 'Bình' })
    const res = await api('POST', '', ADMIN, { owner_id: binh.id })
    expect(res.status).toBe(201)
    expect((await res.json<GwTokenSecretResponse>()).summary.label).toBe('Bình')
  })

  it('đặt lại đổi token, thu hồi xong cấp lại được cho cùng người', async () => {
    const an = await seedUser('an@az.test', { name: 'An' })
    const first = await (
      await api('POST', '', ADMIN, { owner_id: an.id, label: 'An' })
    ).json<GwTokenSecretResponse>()
    const reset = await api('POST', `/${first.summary.id}/reset`, ADMIN, {})
    expect(reset.status).toBe(200)
    expect((await reset.json<GwTokenSecretResponse>()).token).not.toBe(first.token)
    expect((await api('POST', `/${first.summary.id}/revoke`, ADMIN, {})).status).toBe(200)
    expect((await api('POST', `/${first.summary.id}/reset`, ADMIN, {})).status).toBe(409)
    expect((await api('POST', '', ADMIN, { owner_id: an.id, label: 'An' })).status).toBe(201)
    expect((await api('POST', '/9999/revoke', ADMIN, {})).status).toBe(404)
  })

  it('ghi bắt buộc JSON', async () => {
    const res = await app.fetch(
      new Request('http://az.test/api/admin/gw-tokens', {
        method: 'POST',
        headers: { ...ADMIN, 'Content-Type': 'text/plain' },
        body: '{}',
      }),
      env2,
    )
    expect(res.status).toBe(400)
  })
})
