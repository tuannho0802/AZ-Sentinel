import { env } from 'cloudflare:workers'
import { decodeConnectCode, type GwTokenSecretResponse } from '@az-sentinel/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app'
import { resetDb, seedUser } from '../helpers'

const app = createApp()
const ADMIN = { Cookie: 'az_mock_session=admin@az.local' }

function api(
  method: string,
  path: string,
  extra: Record<string, unknown> = {},
  origin = 'http://vps.example.com',
) {
  return app.fetch(
    new Request(`${origin}/api/admin/gw-tokens${path}`, {
      method,
      headers: { ...ADMIN, 'Content-Type': 'application/json' },
      ...(method === 'GET'
        ? {}
        : { body: JSON.stringify(path === '' ? { owner_id: extra.owner_id } : {}) }),
    }),
    { DB: env.DB, LIVE_HUB: env.LIVE_HUB, DEV_LINKS_API: '1', ...(extra.env as object) },
  )
}

beforeEach(resetDb)

describe('mã kết nối trong phản hồi cấp/đặt lại token', () => {
  it('lấy địa chỉ chính theo địa chỉ admin đang truy cập, gói đúng token', async () => {
    const an = await seedUser('an@az.test', { name: 'An' })
    const res = await api('POST', '', { owner_id: an.id })
    expect(res.status).toBe(201)
    const body = await res.json<GwTokenSecretResponse>()
    const p = decodeConnectCode(body.connect_code as string)
    expect(p).toEqual({
      primaryUrl: 'ws://vps.example.com/api/gw/ws',
      fallbackUrl: '',
      token: body.token,
    })
  })

  it('PRIMARY_URL và FALLBACK_URL cấu hình thắng địa chỉ truy cập; https đổi thành wss', async () => {
    const an = await seedUser('an@az.test', { name: 'An' })
    const res = await api('POST', '', {
      owner_id: an.id,
      env: { PRIMARY_URL: 'https://az.vps.io', FALLBACK_URL: 'https://az.workers.dev/' },
    })
    const body = await res.json<GwTokenSecretResponse>()
    expect(decodeConnectCode(body.connect_code as string)).toMatchObject({
      primaryUrl: 'wss://az.vps.io/api/gw/ws',
      fallbackUrl: 'wss://az.workers.dev/api/gw/ws',
      token: body.token,
    })
  })

  it('địa chỉ dự phòng trùng địa chỉ chính thì bỏ (không nối lại chính mình)', async () => {
    const an = await seedUser('an@az.test', { name: 'An' })
    const res = await api('POST', '', {
      owner_id: an.id,
      env: { PRIMARY_URL: 'https://az.vps.io', FALLBACK_URL: 'https://az.vps.io' },
    })
    const body = await res.json<GwTokenSecretResponse>()
    expect(decodeConnectCode(body.connect_code as string)?.fallbackUrl).toBe('')
  })

  it('truy cập bằng localhost và chưa đặt PRIMARY_URL: không có mã, vẫn có token', async () => {
    const an = await seedUser('an@az.test', { name: 'An' })
    const res = await api('POST', '', { owner_id: an.id }, 'http://localhost:8080')
    expect(res.status).toBe(201)
    const body = await res.json<GwTokenSecretResponse>()
    expect(body.connect_code).toBeNull()
    expect(body.token.startsWith('azt_')).toBe(true)
  })

  it('PRIMARY_URL cấu hình vẫn tạo được mã dù admin truy cập bằng localhost', async () => {
    const an = await seedUser('an@az.test', { name: 'An' })
    const res = await api(
      'POST',
      '',
      { owner_id: an.id, env: { PRIMARY_URL: 'https://az.vps.io' } },
      'http://127.0.0.1:8080',
    )
    const body = await res.json<GwTokenSecretResponse>()
    expect(decodeConnectCode(body.connect_code as string)?.primaryUrl).toBe(
      'wss://az.vps.io/api/gw/ws',
    )
  })

  it('PRIMARY_URL sai định dạng: quay về địa chỉ truy cập', async () => {
    const an = await seedUser('an@az.test', { name: 'An' })
    const res = await api('POST', '', { owner_id: an.id, env: { PRIMARY_URL: 'khong-phai-url' } })
    const body = await res.json<GwTokenSecretResponse>()
    expect(decodeConnectCode(body.connect_code as string)?.primaryUrl).toBe(
      'ws://vps.example.com/api/gw/ws',
    )
  })

  it('đặt lại token: mã mới chứa token mới, khác mã cũ', async () => {
    const an = await seedUser('an@az.test', { name: 'An' })
    const first = await (await api('POST', '', { owner_id: an.id })).json<GwTokenSecretResponse>()
    const reset = await (
      await api('POST', `/${first.summary.id}/reset`)
    ).json<GwTokenSecretResponse>()
    expect(reset.token).not.toBe(first.token)
    expect(reset.connect_code).not.toBe(first.connect_code)
    expect(decodeConnectCode(reset.connect_code as string)?.token).toBe(reset.token)
  })

  it('danh sách token không bao giờ chứa mã kết nối hay token thô', async () => {
    const an = await seedUser('an@az.test', { name: 'An' })
    const first = await (await api('POST', '', { owner_id: an.id })).json<GwTokenSecretResponse>()
    const list = await (await api('GET', '')).text()
    expect(list).not.toContain('azc1.')
    expect(list).not.toContain(first.token)
  })
})
