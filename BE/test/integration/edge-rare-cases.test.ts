import { env } from 'cloudflare:workers'
import { SERVED_BY_HEADER, SERVER_MODE_HEADER } from '@az-sentinel/shared'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/app'
import { openDeviceHandoff } from '../../src/edge/device-handoff'
import type { FetchFn } from '../../src/edge/timed-fetch'
import { VpsOriginStore } from '../../src/edge/vps-origin'

/**
 * Ca hiếm của lớp kết nối / chuyển hướng (Plan 3E, 3G, 3J, 3K).
 *
 * Quy ước: test đánh dấu `it.fails` mô tả HÀNH VI ĐÚNG MONG MUỐN nhưng code hiện tại chưa đạt (đã xác
 * nhận bằng cách chạy). Suite vẫn xanh. Khi sửa xong lỗi, vitest báo "expected to fail but passed":
 * lúc đó đổi `it.fails` thành `it`.
 */

const ORIGIN = 'https://vps.test'
const TUNNEL = 'https://abc-123.trycloudflare.com'
const SYNC = 'sync-token-0123456789-abcdefghijkl'
const VPS = { [SERVED_BY_HEADER]: 'vps' }
const html = { Accept: 'text/html', 'Sec-Fetch-Dest': 'document' }

type Call = { url: string; method: string }

/** VPS giả: `handler` quyết định phản hồi; ném lỗi để mô phỏng VPS sập. */
function fakeVps(handler: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = []
  const fetchFn: FetchFn = async (input, init) => {
    calls.push({ url: input, method: init?.method ?? 'GET' })
    return handler(new URL(input), init ?? {})
  }
  return { fetchFn, calls }
}

const healthy = (url: URL) =>
  url.pathname === '/api/health'
    ? Response.json({ status: 'ok' }, { headers: VPS })
    : Response.json({ from: 'vps', path: url.pathname }, { headers: VPS })

const makeApp = (fetchFn: FetchFn) => createApp({ edge: { fetchFn, registry: new Map() } })
const withVps = { DB: env.DB, LIVE_HUB: env.LIVE_HUB, VPS_ORIGIN: ORIGIN, SYNC_TOKEN: SYNC }
type App = ReturnType<typeof makeApp>

const get = (app: App, path: string, extra: object = {}, init: RequestInit = {}) =>
  app.fetch(new Request(`http://az.test${path}`, init), { ...withVps, ...extra })
const post = (app: App, path: string, extra: object = {}, body = '{}') =>
  app.fetch(
    new Request(`http://az.test${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }),
    { ...withVps, ...extra },
  )
const mode = (r: Response) => r.headers.get(SERVER_MODE_HEADER)

describe('VPS tự trả 5xx của ứng dụng không được bị nhầm là "VPS sập"', () => {
  // Lỗi 1: edge-router.ts coi MỌI 502/503/504 là tunnel hỏng, kể cả khi chính ứng dụng VPS trả
  // (ví dụ ingest-service ném 503 khi SQLite lỗi, live-ws/gw-ws trả 503 khi hub lỗi). Phản hồi của ứng dụng
  // luôn mang `X-AZ-Served-By: vps`, nên có thể phân biệt với trang lỗi của tunnel/proxy.
  it('GET: VPS trả 503 kèm header vai trò -> chuyển nguyên 503, không chuyển sang dự phòng', async () => {
    const vps = fakeVps((url) =>
      url.pathname === '/api/health'
        ? healthy(url)
        : Response.json(
            { error: { code: 'SERVICE_UNAVAILABLE', message: 'Dịch vụ tạm thời không khả dụng' } },
            { status: 503, headers: VPS },
          ),
    )
    const app = makeApp(vps.fetchFn)
    const res = await get(app, '/api/some-vps-route')
    expect(res.status).toBe(503)
    expect(res.headers.get(SERVED_BY_HEADER)).toBe('vps')
    expect(mode(res)).toBe('primary')
    // Một lỗi tạm thời của ứng dụng không được làm cả hệ thống đổi sang dự phòng.
    expect(mode(await get(app, '/api/health'))).toBe('primary')
  })

  it('POST ingest: VPS trả 503 (D1/SQLite lỗi) -> EA phải nhận đúng 503 để giữ hàng đợi', async () => {
    const vps = fakeVps((url) =>
      url.pathname === '/api/health'
        ? healthy(url)
        : Response.json(
            { error: { code: 'SERVICE_UNAVAILABLE', message: 'Dịch vụ tạm thời không khả dụng' } },
            { status: 503, headers: VPS },
          ),
    )
    const app = makeApp(vps.fetchFn)
    const res = await post(app, '/api/ea/v1/ingest')
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } })
    expect(mode(await get(app, '/api/health'))).toBe('primary')
  })

  // Bảo vệ hành vi đúng hiện tại để bản sửa lỗi 1 không làm hỏng nó: 5xx của tunnel/proxy (không có header vai trò).
  it.each([502, 503, 504, 521, 522, 523, 524, 530])(
    'trang lỗi %i của tunnel/proxy (không có header vai trò) vẫn là VPS sập',
    async (status) => {
      const vps = fakeVps((url) =>
        url.pathname === '/api/health'
          ? healthy(url)
          : new Response('<html>error</html>', { status }),
      )
      const app = makeApp(vps.fetchFn)
      const res = await get(app, '/api/some-vps-route')
      // GET được thử lại ngay ở Cloudflare (route lạ -> 404 của Worker), và mode báo dự phòng.
      expect(res.headers.get(SERVED_BY_HEADER)).toBe('cloudflare')
      expect(mode(res)).toBe('fallback')
    },
  )

  it.each([400, 401, 403, 404, 409, 429, 500])(
    'VPS trả %i của ứng dụng: chuyển nguyên, vẫn là primary, không đổi sang dự phòng',
    async (status) => {
      const vps = fakeVps((url) =>
        url.pathname === '/api/health'
          ? healthy(url)
          : Response.json({ error: { code: 'X', message: 'x' } }, { status, headers: VPS }),
      )
      const app = makeApp(vps.fetchFn)
      const res = await get(app, '/api/some-vps-route')
      expect(res.status).toBe(status)
      expect(mode(res)).toBe('primary')
      expect(mode(await get(app, '/api/health'))).toBe('primary')
    },
  )
})

describe('chặn ghi khi dự phòng: không lọt qua biến thể đường dẫn', () => {
  const down = () => {
    const vps = fakeVps(() => {
      throw new Error('down')
    })
    return makeApp(vps.fetchFn)
  }

  // Phải bị chặn (503 READ_ONLY_FALLBACK) hoặc không có route (404); tuyệt đối không tới handler (401/400/2xx).
  it.each([
    '/api/links/1/trade',
    '/api/links/1/trade/',
    '/api/links',
    '/api/links/1/status',
    '/api/%6Cinks/1/trade',
    '/api/%6cinks/1/trade',
    '/api//links/1/trade',
    '/api/admin/users',
    '/api/admin/gw-tokens',
    '/api/admin/ip-rules',
    '/api/admin/device-rules',
    '/api/settings/alerts',
    '/api/dev/links',
  ])('POST %s khi VPS sập không tới được handler ghi', async (path) => {
    const res = await post(down(), path)
    expect([503, 404]).toContain(res.status)
    if (res.status === 503) {
      expect(await res.json()).toMatchObject({ error: { code: 'READ_ONLY_FALLBACK' } })
    }
  })

  it.each(['PUT', 'PATCH', 'DELETE'])('%s cũng bị chặn, không chỉ POST', async (method) => {
    const res = await down().fetch(new Request('http://az.test/api/links/1', { method }), withVps)
    expect(res.status).toBe(503)
  })

  it.each(['true', 'TRUE', 'yes', '0', '2', ' 1', ''])(
    'FALLBACK_WRITABLE=%j không mở khóa ghi (chỉ đúng "1")',
    async (flag) => {
      const res = await post(down(), '/api/links/1/trade', { FALLBACK_WRITABLE: flag })
      expect(res.status).toBe(503)
    },
  )
})

describe('Worker chuyển hướng trang: ca hiếm', () => {
  function make(opts: { learned?: string | null; extra?: Record<string, string> } = {}) {
    const served: string[] = []
    const fetchFn: FetchFn = async () => Response.json({ status: 'ok' }, { headers: VPS })
    const origins = new VpsOriginStore()
    origins.remember(opts.learned === undefined ? TUNNEL : opts.learned)
    const app = createApp({ edge: { fetchFn, registry: new Map(), origins } })
    const ASSETS = {
      fetch: async (req: Request) => {
        served.push(new URL(req.url).pathname)
        return new Response('<html>fallback</html>', { headers: { 'Content-Type': 'text/html' } })
      },
    } as unknown as Fetcher
    const nav = (path: string, headers: Record<string, string> = html) =>
      app.fetch(new Request(`https://az.test${path}`, { headers }), {
        DB: env.DB,
        LIVE_HUB: env.LIVE_HUB,
        ASSETS,
        ...opts.extra,
      })
    return { nav, served }
  }

  it('đường dẫn dạng //evil.com hay /\\evil.com không đẩy người dùng sang host khác', async () => {
    const t = make()
    for (const path of ['//evil.com/x', '/\\evil.com/x', '///evil.com', '/%2F%2Fevil.com']) {
      const res = await t.nav(path)
      expect(res.status).toBe(302)
      const location = new URL(res.headers.get('Location') ?? '')
      expect(location.host).toBe('abc-123.trycloudflare.com')
    }
  })

  it('query kiểu ?next=https://evil.com được giữ nguyên nhưng host đích vẫn là tunnel', async () => {
    const res = await make().nav('/login?next=https://evil.com&x=1')
    const location = new URL(res.headers.get('Location') ?? '')
    expect(location.host).toBe('abc-123.trycloudflare.com')
    expect(location.searchParams.get('next')).toBe('https://evil.com')
  })

  it('địa chỉ đã học trùng host với Worker (cấu hình sai): không chuyển hướng, không vòng lặp', async () => {
    const t = make({ learned: 'https://az.test' })
    const res = await t.nav('/links')
    expect(res.status).toBe(200)
    expect(t.served).toEqual(['/links'])
  })

  it('client tự đặt ?az_dh=...: bị thay bằng đúng MỘT vé hợp lệ do Worker cấp, kể cả khi lặp tham số', async () => {
    const t = make({ extra: { SYNC_TOKEN: SYNC } })
    const res = await t.nav('/?az_dh=ke-tan-cong&az_dh=v1.xxxx&keep=1')
    expect(res.status).toBe(302)
    const location = new URL(res.headers.get('Location') ?? '')
    const tickets = location.searchParams.getAll('az_dh')
    expect(tickets).toHaveLength(1)
    expect(tickets[0]).not.toBe('ke-tan-cong')
    expect(
      await openDeviceHandoff(SYNC, tickets[0] ?? '', Math.floor(Date.now() / 1000)),
    ).not.toBeNull()
    expect(location.searchParams.get('keep')).toBe('1')
  })

  it('vé không lộ mã thiết bị thô trong URL và không dùng được khi sai khóa', async () => {
    const res = await make({ extra: { SYNC_TOKEN: SYNC } }).nav('/')
    const cookie = (res.headers.get('Set-Cookie') ?? '').split(';')[0] ?? ''
    const raw = cookie.slice(cookie.indexOf('=') + 1)
    const location = res.headers.get('Location') ?? ''
    expect(raw.length).toBeGreaterThan(20)
    expect(location).not.toContain(raw)
    const ticket = new URL(location).searchParams.get('az_dh') ?? ''
    const now = Math.floor(Date.now() / 1000)
    expect(await openDeviceHandoff('khoa-khac-0123456789', ticket, now)).toBeNull()
    // Vé quá hạn 61 giây không mở được.
    expect(await openDeviceHandoff(SYNC, ticket, now + 61)).toBeNull()
  })

  it('HEAD và GET mang Accept text/html nhưng Sec-Fetch-Dest=image/script/iframe không bị chuyển hướng', async () => {
    const t = make()
    for (const dest of ['image', 'script', 'iframe', 'style', 'font', 'empty']) {
      const res = await t.nav('/x', { Accept: 'text/html', 'Sec-Fetch-Dest': dest })
      expect(res.status).toBe(200)
    }
    expect(t.served).toHaveLength(6)
  })
})

describe('/api/server-info: xác thực dự phòng qua VPS', () => {
  const me = (body: unknown, status = 200) =>
    fakeVps((url) =>
      url.pathname === '/api/me' ? Response.json(body, { status, headers: VPS }) : healthy(url),
    )

  // Lỗi 2: viewerViaVps luôn gọi `${origin}/api/me` mà không hỏi trạng thái dò (probe). /api/server-info nằm trong
  // LOCAL_ONLY nên không qua bộ dò: một vòng lặp request mang Cookie rác làm Worker gọi sang VPS đã chết mỗi lần
  // (mỗi lần chờ tới 2,5 giây, tốn hạn mức subrequest).
  it('VPS đã sập: nhiều request mang Cookie rác không được gọi /api/me mỗi lần', async () => {
    const vps = fakeVps(() => {
      throw new Error('down')
    })
    const app = makeApp(vps.fetchFn)
    for (let i = 0; i < 5; i++) {
      const res = await get(
        app,
        '/api/server-info',
        {},
        { headers: { Cookie: `az_session=rac-${i}` } },
      )
      expect(res.status).toBe(401)
    }
    const meCalls = vps.calls.filter((c) => c.url.endsWith('/api/me')).length
    expect(meCalls).toBeLessThanOrEqual(1)
  })

  it('không có Cookie thì không gọi VPS và trả 401', async () => {
    const vps = me({ id: 1, role: 'root_admin' })
    const res = await get(makeApp(vps.fetchFn), '/api/server-info')
    expect(res.status).toBe(401)
    expect(vps.calls).toHaveLength(0)
  })

  it.each([
    ['vai trò lạ', { id: 1, role: 'superuser' }],
    ['id là chuỗi', { id: '1', role: 'root_admin' }],
    ['thiếu id', { role: 'root_admin' }],
    ['thân rỗng', {}],
    ['null', null],
  ])('VPS trả %s: không được coi là đã đăng nhập', async (_name, body) => {
    const vps = me(body)
    const res = await get(
      makeApp(vps.fetchFn),
      '/api/server-info',
      {},
      { headers: { Cookie: 'az_session=abc' } },
    )
    expect(res.status).toBe(401)
  })

  it('VPS trả 401, 500 hoặc thân không phải JSON: 401, không ném 500', async () => {
    for (const make of [
      () => me({ error: 'x' }, 401),
      () => me({ error: 'x' }, 500),
      () => fakeVps(() => new Response('<html>', { status: 200, headers: VPS })),
    ]) {
      const res = await get(
        makeApp(make().fetchFn),
        '/api/server-info',
        {},
        { headers: { Cookie: 'az_session=abc' } },
      )
      expect(res.status).toBe(401)
    }
  })
})
