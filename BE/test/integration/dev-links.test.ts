import { env } from 'cloudflare:workers'
import type {
  CreateLinkResponse,
  LinkDetail,
  LinkListResponse,
  LinkSummary,
} from '@az-sentinel/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app'
import { count, makePayload, post, resetDb, tradeEvent } from '../helpers'

const app = createApp()

function dev(path: string, init: RequestInit = {}, enabled = true) {
  const headers = new Headers(init.headers)
  if (init.method && init.method !== 'GET' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  return app.fetch(
    new Request(`http://az.test/api/dev${path}`, { ...init, headers }),
    enabled ? { DB: env.DB, DEV_LINKS_API: '1' } : { DB: env.DB },
  )
}

async function createLink() {
  const res = await dev('/links', { method: 'POST', body: '{}' })
  expect(res.status).toBe(201)
  return (await res.json()) as CreateLinkResponse
}

beforeEach(resetDb)

describe('/api/dev (chỉ bật khi DEV_LINKS_API=1)', () => {
  it('trả 404 khi chưa bật biến, kể cả thao tác ghi', async () => {
    expect((await dev('/links', {}, false)).status).toBe(404)
    expect((await dev('/links', { method: 'POST', body: '{}' }, false)).status).toBe(404)
    expect(await count('ea_links')).toBe(0)
  })

  it('từ chối thao tác ghi không phải JSON', async () => {
    const res = await dev('/links', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'x',
    })
    expect(res.status).toBe(400)
    expect(await count('ea_links')).toBe(0)
  })

  it('danh sách rỗng ban đầu', async () => {
    const body = (await (await dev('/links')).json()) as LinkListResponse
    expect(body.links).toEqual([])
  })

  it('tạo liên kết trả khóa một lần, DB chỉ lưu băm, chưa gắn tài khoản', async () => {
    const { link, api_key } = await createLink()
    expect(api_key.length).toBeGreaterThanOrEqual(40)
    expect(link.key_prefix).toBe(api_key.slice(0, 8))
    expect(link.account).toBeNull()
    expect(link.state).toBeNull()
    const list = JSON.stringify(await (await dev('/links')).json())
    expect(list).not.toContain(api_key)
    const rows = await env.DB.prepare('SELECT key_hash FROM ea_links').all<{ key_hash: string }>()
    expect(rows.results[0]?.key_hash).not.toBe(api_key)
  })

  it('đăng ký end-to-end: khóa mới + ingest đầu tiên gắn tài khoản và hiện số liệu', async () => {
    const { link, api_key } = await createLink()
    const res = await post(api_key, makePayload())
    expect(res.status).toBe(200)

    const list = (await (await dev('/links')).json()) as LinkListResponse
    const item = list.links.find((l) => l.id === link.id) as LinkSummary
    expect(item.account?.login).toBe(12345678)
    expect(item.account?.server).toBe('Broker-Live01')
    expect(item.state?.equity).toBe(10050.5)
    expect(item.state?.online).toBe(true)
    expect(item.state?.vps_label).toBe('VPS-A12')
  })

  it('chi tiết có vị thế đang mở và sự kiện', async () => {
    const { link, api_key } = await createLink()
    await post(
      api_key,
      makePayload({
        positions: [
          {
            ticket: 5001,
            symbol: 'XAUUSD',
            type: 'buy',
            volume: 0.1,
            time: 1792499000,
            price: 4010.12,
          },
        ],
        events: [tradeEvent({})],
      }),
    )
    const detail = (await (await dev(`/links/${link.id}`)).json()) as LinkDetail
    expect(detail.positions).toHaveLength(1)
    expect(detail.positions[0]?.symbol).toBe('XAUUSD')
    expect(detail.state?.positions_count).toBe(1)
  })

  it('ghi nhận tài khoản khác dùng cùng khóa vào events (auth_fail)', async () => {
    const { link, api_key } = await createLink()
    await post(api_key, makePayload())
    const other = makePayload({ sid: 'other' }) as unknown as { account: { login: number } }
    other.account.login = 999
    expect((await post(api_key, other)).status).toBe(409)
    const detail = (await (await dev(`/links/${link.id}`)).json()) as LinkDetail
    expect(detail.events.map((e) => e.type)).toContain('auth_fail')
  })

  it('khóa liên kết thì ingest bị 403, mở lại thì nhận lại', async () => {
    const { link, api_key } = await createLink()
    const off = await dev(`/links/${link.id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status: 'disabled' }),
    })
    expect(((await off.json()) as LinkSummary).status).toBe('disabled')
    expect((await post(api_key, makePayload())).status).toBe(403)
    await dev(`/links/${link.id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status: 'active' }),
    })
    expect((await post(api_key, makePayload())).status).toBe(200)
  })

  it('trạng thái không hợp lệ bị 400', async () => {
    const { link } = await createLink()
    const res = await dev(`/links/${link.id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status: 'x' }),
    })
    expect(res.status).toBe(400)
  })

  it('cấp lại khóa: khóa cũ bị 401, khóa mới dùng được và giữ nguyên tài khoản đã gắn', async () => {
    const { link, api_key: oldKey } = await createLink()
    await post(oldKey, makePayload())
    const res = await dev(`/links/${link.id}/rotate-key`, { method: 'POST', body: '{}' })
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    const rotated = (await res.json()) as CreateLinkResponse
    expect(rotated.api_key).not.toBe(oldKey)
    expect(rotated.link.key_prefix).toBe(rotated.api_key.slice(0, 8))
    expect(rotated.link.account?.login).toBe(12345678)
    expect((await post(oldKey, makePayload())).status).toBe(401)
    expect((await post(rotated.api_key, makePayload())).status).toBe(200)
    const list = JSON.stringify(await (await dev('/links')).json())
    expect(list).not.toContain(rotated.api_key)
  })

  it('cấp lại khóa cho id không tồn tại hoặc khi chưa bật cờ', async () => {
    expect((await dev('/links/12345/rotate-key', { method: 'POST', body: '{}' })).status).toBe(404)
    const { link } = await createLink()
    const off = await dev(`/links/${link.id}/rotate-key`, { method: 'POST', body: '{}' }, false)
    expect(off.status).toBe(404)
  })

  it('gỡ gắn cho phép gắn tài khoản MT5 khác, xóa dữ liệu cũ', async () => {
    const { link, api_key } = await createLink()
    await post(api_key, makePayload())
    const res = await dev(`/links/${link.id}/unbind`, { method: 'POST', body: '{}' })
    const unbound = (await res.json()) as LinkSummary
    expect(unbound.account).toBeNull()
    expect(unbound.state).toBeNull()
    expect(await count('link_state')).toBe(0)
    const other = makePayload({ sid: 'other' }) as unknown as { account: { login: number } }
    other.account.login = 999
    expect((await post(api_key, other)).status).toBe(200)
    const detail = (await (await dev(`/links/${link.id}`)).json()) as LinkDetail
    expect(detail.account?.login).toBe(999)
  })

  it('xóa liên kết xóa cả dữ liệu liên quan; khóa cũ không còn dùng được', async () => {
    const { link, api_key } = await createLink()
    await post(api_key, makePayload({ events: [tradeEvent({})] }))
    expect((await dev(`/links/${link.id}`, { method: 'DELETE' })).status).toBe(204)
    expect(await count('ea_links')).toBe(0)
    expect(await count('link_state')).toBe(0)
    expect(await count('trades')).toBe(0)
    expect((await post(api_key, makePayload())).status).toBe(401)
  })

  it.each(['abc', '0', '99999999999'])('id không hợp lệ (%s) trả 404', async (id) => {
    expect((await dev(`/links/${id}`)).status).toBe(404)
  })

  it('id không tồn tại trả 404', async () => {
    expect((await dev('/links/12345')).status).toBe(404)
    expect((await dev('/links/12345', { method: 'DELETE' })).status).toBe(404)
  })

  it('giới hạn 20 liên kết', async () => {
    for (let i = 0; i < 20; i++) await createLink()
    const res = await dev('/links', { method: 'POST', body: '{}' })
    expect(res.status).toBe(400)
  })
})

describe('tên VPS do người dùng nhập', () => {
  const create = async (body: unknown) => {
    const res = await dev('/links', { method: 'POST', body: JSON.stringify(body) })
    return { res, json: (await res.json()) as CreateLinkResponse }
  }
  const setName = (id: number, vps_name: unknown) =>
    dev(`/links/${id}/vps-name`, { method: 'POST', body: JSON.stringify({ vps_name }) })

  it('tạo liên kết không kèm tên thì vps_name là null', async () => {
    const { link } = await createLink()
    expect(link.vps_name).toBeNull()
  })

  it('tạo liên kết kèm tên: được chuẩn hóa, có trong danh sách và chi tiết', async () => {
    const { res, json } = await create({ vps_name: '  VPS   Hà Nội 01 ' })
    expect(res.status).toBe(201)
    expect(json.link.vps_name).toBe('VPS Hà Nội 01')
    const list = (await (await dev('/links')).json()) as LinkListResponse
    expect(list.links[0]?.vps_name).toBe('VPS Hà Nội 01')
    const detail = (await (await dev(`/links/${json.link.id}`)).json()) as LinkDetail
    expect(detail.vps_name).toBe('VPS Hà Nội 01')
  })

  it('tên toàn khoảng trắng thì coi như không đặt; sai kiểu bị 400 và không tạo liên kết', async () => {
    expect((await create({ vps_name: '   ' })).json.link.vps_name).toBeNull()
    const before = await count('ea_links')
    const bad = await dev('/links', { method: 'POST', body: JSON.stringify({ vps_name: 5 }) })
    expect(bad.status).toBe(400)
    expect(await count('ea_links')).toBe(before)
  })

  it('đổi tên rồi xóa tên; id không tồn tại hoặc dữ liệu sai thì lỗi', async () => {
    const { link } = await createLink()
    const renamed = (await (await setName(link.id, 'VPS-02')).json()) as LinkSummary
    expect(renamed.vps_name).toBe('VPS-02')
    const cleared = (await (await setName(link.id, '')).json()) as LinkSummary
    expect(cleared.vps_name).toBeNull()
    expect((await setName(999999, 'x')).status).toBe(404)
    expect((await setName(link.id, 5)).status).toBe(400)
    expect((await dev(`/links/${link.id}/vps-name`, { method: 'POST', body: '{}' })).status).toBe(
      400,
    )
  })

  it('đổi tên không làm đổi khóa hay tài khoản đã gắn', async () => {
    const { link, api_key } = await createLink()
    await post(api_key, makePayload())
    await setName(link.id, 'VPS-03')
    const detail = (await (await dev(`/links/${link.id}`)).json()) as LinkDetail
    expect(detail.vps_name).toBe('VPS-03')
    expect(detail.account?.login).toBeDefined()
    expect(detail.key_prefix).toBe(link.key_prefix)
  })
})
