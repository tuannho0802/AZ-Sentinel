import { env } from 'cloudflare:workers'
import { SERVED_BY_HEADER, SERVER_MODE_HEADER } from '@az-sentinel/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app'
import type { FetchFn } from '../../src/edge/timed-fetch'
import { VpsProbe } from '../../src/edge/vps-probe'

const ORIGIN = 'https://vps.test'
const VPS_HEADERS = { [SERVED_BY_HEADER]: 'vps' }

type Call = { url: string; init: RequestInit }

/** VPS giả: `handler` quyết định phản hồi; ném lỗi để mô phỏng VPS sập. */
function fakeVps(handler: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = []
  const fetchFn: FetchFn = async (input, init) => {
    calls.push({ url: input, init: init ?? {} })
    return handler(new URL(input), init ?? {})
  }
  return { fetchFn, calls }
}

const healthy = (url: URL) =>
  url.pathname === '/api/health'
    ? Response.json({ status: 'ok' }, { headers: VPS_HEADERS })
    : Response.json({ from: 'vps', path: url.pathname }, { headers: VPS_HEADERS })

function makeApp(fetchFn: FetchFn) {
  return createApp({ edge: { fetchFn, registry: new Map() } })
}

const baseEnv = { DB: env.DB, LIVE_HUB: env.LIVE_HUB }
const withVps = { ...baseEnv, VPS_ORIGIN: ORIGIN, SYNC_TOKEN: 'sync-token-0123456789' }

const get = (app: ReturnType<typeof makeApp>, path: string, e: object = withVps) =>
  app.fetch(new Request(`http://az.test${path}`), e)

describe('bộ định tuyến biên (Plan 3E)', () => {
  it('không cấu hình VPS_ORIGIN: chạy một mình trên Cloudflare (standalone)', async () => {
    const vps = fakeVps(healthy)
    const res = await get(makeApp(vps.fetchFn), '/api/health', baseEnv)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
    expect(res.headers.get(SERVED_BY_HEADER)).toBe('cloudflare')
    expect(res.headers.get(SERVER_MODE_HEADER)).toBe('standalone')
    expect(vps.calls).toHaveLength(0)
  })

  it('VPS sống: chuyển tiếp sang VPS, header cho biết VPS phục vụ', async () => {
    const vps = fakeVps(healthy)
    const res = await get(makeApp(vps.fetchFn), '/api/ea/v1/gate')
    expect(await res.json()).toEqual({ from: 'vps', path: '/api/ea/v1/gate' })
    expect(res.headers.get(SERVED_BY_HEADER)).toBe('vps')
    expect(res.headers.get(SERVER_MODE_HEADER)).toBe('primary')
  })

  it('chuyển IP và host thật của người dùng cho VPS, bỏ header Host gốc', async () => {
    const vps = fakeVps(healthy)
    await makeApp(vps.fetchFn).fetch(
      new Request('http://az.test/api/x?a=1', {
        headers: { 'CF-Connecting-IP': '203.0.113.9', Cookie: 's=1' },
      }),
      withVps,
    )
    const fwd = vps.calls.find((c) => c.url.includes('/api/x'))
    expect(fwd?.url).toBe(`${ORIGIN}/api/x?a=1`)
    const h = new Headers(fwd?.init.headers)
    expect(h.get('X-AZ-Client-IP')).toBe('203.0.113.9')
    expect(h.get('X-Forwarded-Host')).toBe('az.test')
    expect(h.get('Cookie')).toBe('s=1')
  })

  it('POST chuyển tiếp kèm body nguyên vẹn', async () => {
    const vps = fakeVps(async (url, init) =>
      url.pathname === '/api/health'
        ? healthy(url)
        : Response.json(
            { echoed: await new Response(init.body as BodyInit).text() },
            { headers: VPS_HEADERS },
          ),
    )
    const res = await makeApp(vps.fetchFn).fetch(
      new Request('http://az.test/api/ea/v1/ingest', { method: 'POST', body: '{"a":1}' }),
      withVps,
    )
    expect(await res.json()).toEqual({ echoed: '{"a":1}' })
  })

  it('VPS sập (fetch lỗi): Cloudflare tự xử lý, header báo fallback', async () => {
    const vps = fakeVps(() => {
      throw new Error('ECONNREFUSED')
    })
    const res = await get(makeApp(vps.fetchFn), '/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
    expect(res.headers.get(SERVED_BY_HEADER)).toBe('cloudflare')
    expect(res.headers.get(SERVER_MODE_HEADER)).toBe('fallback')
  })

  it('tunnel trả 530 (VPS không với tới): coi như sập, đọc thử lại ở Cloudflare', async () => {
    const vps = fakeVps(() => new Response('error code: 1033', { status: 530 }))
    const res = await get(makeApp(vps.fetchFn), '/api/health')
    expect(res.status).toBe(200)
    expect(res.headers.get(SERVER_MODE_HEADER)).toBe('fallback')
  })

  it('trang 200 không phải của VPS (thiếu header vai trò) không được coi là VPS sống', async () => {
    const vps = fakeVps(() => Response.json({ status: 'ok' }))
    const res = await get(makeApp(vps.fetchFn), '/api/health')
    expect(res.headers.get(SERVER_MODE_HEADER)).toBe('fallback')
  })

  it('VPS chết giữa chừng lúc ghi: 502 một lần, không ghi hai nơi; request sau đi dự phòng', async () => {
    let alive = true
    const vps = fakeVps((url) => {
      if (!alive) throw new Error('reset')
      return healthy(url)
    })
    const app = makeApp(vps.fetchFn)
    expect((await get(app, '/api/health')).headers.get(SERVER_MODE_HEADER)).toBe('primary')
    alive = false
    const post = await app.fetch(
      new Request('http://az.test/api/ea/v1/ingest', { method: 'POST', body: '{}' }),
      withVps,
    )
    expect(post.status).toBe(502)
    expect(await post.json()).toMatchObject({ error: { code: 'UPSTREAM_FAILED' } })
    const next = await get(app, '/api/health')
    expect(next.headers.get(SERVER_MODE_HEADER)).toBe('fallback')
  })

  it('VPS sống lại: lần dò kế tiếp đưa lưu lượng về VPS', async () => {
    let alive = false
    const vps = fakeVps((url) => {
      if (!alive) throw new Error('down')
      return healthy(url)
    })
    const registry = new Map<string, VpsProbe>()
    let now = 1_000_000
    registry.set(ORIGIN, new VpsProbe(ORIGIN, vps.fetchFn, () => now))
    const app = createApp({ edge: { fetchFn: vps.fetchFn, registry } })
    expect((await get(app, '/api/health')).headers.get(SERVER_MODE_HEADER)).toBe('fallback')
    alive = true
    expect((await get(app, '/api/health')).headers.get(SERVER_MODE_HEADER)).toBe('fallback') // còn trong hạn nhớ tạm
    now += 6_000
    expect((await get(app, '/api/health')).headers.get(SERVER_MODE_HEADER)).toBe('primary')
  })

  it('nâng cấp WebSocket đi qua nguyên vẹn (không bị Hono bọc làm mất webSocket)', async () => {
    const pair = new WebSocketPair()
    const vps = fakeVps((url, init) => {
      if (url.pathname === '/api/health') return healthy(url)
      expect(new Headers(init.headers).get('Upgrade')).toBe('websocket')
      return new Response(null, { status: 101, webSocket: pair[0] })
    })
    const res = await makeApp(vps.fetchFn).fetch(
      new Request('http://az.test/api/live/ws?scope=links', { headers: { Upgrade: 'websocket' } }),
      withVps,
    )
    expect(res.status).toBe(101)
    expect(res.webSocket).toBeTruthy()
  })

  it('dự phòng: chặn ghi liên kết (/api/dev) để hai DB không lệch, vẫn cho đọc', async () => {
    const vps = fakeVps(() => {
      throw new Error('down')
    })
    const app = makeApp(vps.fetchFn)
    const dev = { ...withVps, DEV_LINKS_API: '1' }
    const post = await app.fetch(
      new Request('http://az.test/api/dev/links', { method: 'POST' }),
      dev,
    )
    expect(post.status).toBe(503)
    expect(await post.json()).toMatchObject({ error: { code: 'READ_ONLY_FALLBACK' } })
    const read = await app.fetch(new Request('http://az.test/api/dev/links'), dev)
    expect(read.status).toBe(200)
  })

  it('dự phòng: chặn cấp/đặt lại/thu hồi token (/api/admin) nhưng vẫn cho đọc', async () => {
    const vps = fakeVps(() => {
      throw new Error('down')
    })
    const app = makeApp(vps.fetchFn)
    const dev = { ...withVps, DEV_LINKS_API: '1' }
    const admin = { Cookie: 'az_mock_session=admin@az.local' }
    const post = await app.fetch(
      new Request('http://az.test/api/admin/gw-tokens', { method: 'POST', headers: admin }),
      dev,
    )
    expect(post.status).toBe(503)
    expect(await post.json()).toMatchObject({ error: { code: 'READ_ONLY_FALLBACK' } })
    const read = await app.fetch(
      new Request('http://az.test/api/admin/gw-tokens', { headers: admin }),
      dev,
    )
    expect(read.status).toBe(200)
  })

  it('FALLBACK_WRITABLE=1 mở khóa ghi khi khẩn cấp', async () => {
    const vps = fakeVps(() => {
      throw new Error('down')
    })
    const res = await makeApp(vps.fetchFn).fetch(
      new Request('http://az.test/api/dev/links', { method: 'POST' }),
      { ...withVps, DEV_LINKS_API: '1', FALLBACK_WRITABLE: '1' },
    )
    expect(res.status).not.toBe(503)
  })
})

describe('VpsProbe', () => {
  it('nhớ tạm kết quả dò và chỉ dò một lần cho nhiều request đồng thời', async () => {
    const vps = fakeVps(healthy)
    let now = 5_000
    const probe = new VpsProbe(ORIGIN, vps.fetchFn, () => now)
    const results = await Promise.all([probe.isUp(), probe.isUp(), probe.isUp()])
    expect(results).toEqual([true, true, true])
    expect(vps.calls).toHaveLength(1)
    now += 9_000
    await probe.isUp()
    expect(vps.calls).toHaveLength(1) // còn hạn 10 giây
    now += 2_000
    await probe.isUp()
    expect(vps.calls).toHaveLength(2)
  })

  it('markDown làm request kế tiếp đi dự phòng ngay và ghi mốc bắt đầu sập', async () => {
    const vps = fakeVps(healthy)
    const probe = new VpsProbe(ORIGIN, vps.fetchFn, () => 7_000_000)
    await probe.isUp()
    probe.markDown()
    expect(await probe.isUp()).toBe(false)
    expect(probe.snapshot()).toMatchObject({ up: false, downSince: 7000, lastUpAt: 7000 })
  })
})

beforeEach(() => {
  // mỗi test tự tạo app và sổ đăng ký riêng; không có trạng thái dùng chung cần dọn
})
