import { env } from 'cloudflare:workers'
import {
  DEVICE_COOKIE,
  DEVICE_HANDOFF_PARAM,
  isRawDeviceId,
  PAGE_STAY_PARAM,
  SERVED_BY_HEADER,
} from '@az-sentinel/shared'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/app'
import { openDeviceHandoff } from '../../src/edge/device-handoff'
import { isPageNavigation } from '../../src/edge/page-router'
import type { FetchFn } from '../../src/edge/timed-fetch'
import { VpsOriginStore } from '../../src/edge/vps-origin'

const TUNNEL = 'https://abc-123.trycloudflare.com'
const html = { Accept: 'text/html', 'Sec-Fetch-Dest': 'document' }

/** ASSETS giả: ghi lại đường dẫn Worker tự phục vụ. */
function make(
  opts: { alive?: boolean; learned?: string | null; extra?: Record<string, string> } = {},
) {
  const served: string[] = []
  let probes = 0
  const fetchFn: FetchFn = async () => {
    probes++
    if (opts.alive === false) throw new Error('down')
    return Response.json({ status: 'ok' }, { headers: { [SERVED_BY_HEADER]: 'vps' } })
  }
  const origins = new VpsOriginStore()
  origins.remember(opts.learned === undefined ? TUNNEL : opts.learned)
  const app = createApp({ edge: { fetchFn, registry: new Map(), origins } })
  const ASSETS = {
    fetch: async (req: Request) => {
      served.push(new URL(req.url).pathname)
      return new Response('<html>fallback</html>', { headers: { 'Content-Type': 'text/html' } })
    },
  } as unknown as Fetcher
  const get = (path: string, headers: Record<string, string> = html) =>
    app.fetch(new Request(`https://az.test${path}`, { headers }), {
      DB: env.DB,
      LIVE_HUB: env.LIVE_HUB,
      ASSETS,
      ...opts.extra,
    })
  return { get, served, probes: () => probes }
}

describe('Worker chuyển hướng trang sang Quick Tunnel (Plan 3J)', () => {
  it('tunnel sống: 302 sang tunnel, giữ đường dẫn và query, không phục vụ giao diện', async () => {
    const t = make()
    const res = await t.get('/links/3?tab=live')
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe(`${TUNNEL}/links/3?tab=live`)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(t.served).toEqual([])
  })

  it('dò tunnel được nhớ tạm: nhiều lượt vào chỉ dò một lần', async () => {
    const t = make()
    await t.get('/')
    await t.get('/links')
    expect(t.probes()).toBe(1)
  })

  it('tunnel chết: phục vụ giao diện dự phòng, không chuyển hướng', async () => {
    const t = make({ alive: false })
    const res = await t.get('/links')
    expect(res.status).toBe(200)
    expect(t.served).toEqual(['/links'])
  })

  it('chưa biết tunnel nào: phục vụ giao diện dự phòng', async () => {
    const t = make({ learned: null })
    expect((await t.get('/')).status).toBe(200)
    expect(t.probes()).toBe(0)
  })

  it('có tham số ở lại: không chuyển hướng dù tunnel sống (không dò)', async () => {
    const t = make()
    const res = await t.get(`/links?${PAGE_STAY_PARAM}=1`)
    expect(res.status).toBe(200)
    expect(t.probes()).toBe(0)
  })

  it('PAGE_REDIRECT=0: luôn phục vụ tại Worker', async () => {
    const t = make({ extra: { PAGE_REDIRECT: '0' } })
    expect((await t.get('/')).status).toBe(200)
  })

  it('VPS_ORIGIN đặt tay chỉ được chuyển hướng khi PAGE_REDIRECT=1', async () => {
    const manual = { VPS_ORIGIN: 'https://vps.example.com' }
    expect((await make({ learned: null, extra: manual }).get('/')).status).toBe(200)
    const on = await make({ learned: null, extra: { ...manual, PAGE_REDIRECT: '1' } }).get('/x')
    expect(on.status).toBe(302)
    expect(on.headers.get('Location')).toBe('https://vps.example.com/x')
  })

  it('không chuyển hướng request không phải tải trang (fetch tệp, POST)', async () => {
    const t = make()
    const res = await t.get('/manifest.json', { Accept: '*/*', 'Sec-Fetch-Dest': 'empty' })
    expect(res.status).toBe(200)
    expect(t.probes()).toBe(0)
  })

  it('đường /api không khớp route vẫn 404 JSON', async () => {
    const res = await make({ learned: null }).get('/api/khong-co', { Accept: 'application/json' })
    expect(res.status).toBe(404)
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: 'NOT_FOUND' },
    })
  })

  it('isPageNavigation: dựa vào Sec-Fetch-Dest, không có thì dựa vào Accept', () => {
    const req = (init: RequestInit) => new Request('https://az.test/', init)
    expect(isPageNavigation(req({ headers: { 'Sec-Fetch-Dest': 'document' } }))).toBe(true)
    expect(
      isPageNavigation(req({ headers: { 'Sec-Fetch-Dest': 'script', Accept: 'text/html' } })),
    ).toBe(false)
    expect(isPageNavigation(req({ headers: { Accept: 'text/html,*/*' } }))).toBe(true)
    expect(isPageNavigation(req({ method: 'POST', headers: html }))).toBe(false)
  })
})

describe('Worker giữ mã thiết bị qua các lần tunnel đổi địa chỉ (Plan 3K)', () => {
  const SECRET = 'sync-token-0123456789-abcdefghijkl'
  const RAW = 'AbCdEfGhIjKlMnOpQrStUvWx'
  const nowSec = () => Math.floor(Date.now() / 1000)
  const ticketOf = (res: Response) => new URL(res.headers.get('Location') ?? '').searchParams

  it('lần đầu: cấp mã thiết bị mới bằng cookie của Worker và gắn vé vào link tunnel', async () => {
    const t = make({ extra: { SYNC_TOKEN: SECRET } })
    const res = await t.get('/links/3?tab=live')
    expect(res.status).toBe(302)
    const loc = new URL(res.headers.get('Location') ?? '')
    expect(`${loc.origin}${loc.pathname}`).toBe(`${TUNNEL}/links/3`)
    expect(loc.searchParams.get('tab')).toBe('live') // query cũ giữ nguyên

    const cookie = res.headers.get('Set-Cookie') ?? ''
    expect(cookie).toMatch(new RegExp(`^${DEVICE_COOKIE}=`))
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    const raw = /^az_dev=([^;]+)/.exec(cookie)?.[1]
    expect(isRawDeviceId(raw)).toBe(true)

    const opened = await openDeviceHandoff(
      SECRET,
      ticketOf(res).get(DEVICE_HANDOFF_PARAM) ?? '',
      nowSec(),
    )
    expect(opened?.raw).toBe(raw) // vé mang đúng mã vừa cấp
  })

  it('đã có cookie thiết bị: dùng lại đúng mã đó và không cấp lại cookie', async () => {
    const t = make({ extra: { SYNC_TOKEN: SECRET } })
    const res = await t.get('/', { ...html, Cookie: `${DEVICE_COOKIE}=${RAW}` })
    expect(res.headers.get('Set-Cookie')).toBeNull()
    const opened = await openDeviceHandoff(
      SECRET,
      ticketOf(res).get(DEVICE_HANDOFF_PARAM) ?? '',
      nowSec(),
    )
    expect(opened?.raw).toBe(RAW)
  })

  it('cookie hỏng/giả (không đúng định dạng) bị thay bằng mã mới, không chuyển tiếp nguyên văn', async () => {
    const t = make({ extra: { SYNC_TOKEN: SECRET } })
    const res = await t.get('/', { ...html, Cookie: `${DEVICE_COOKIE}=<script>` })
    const raw = /^az_dev=([^;]+)/.exec(res.headers.get('Set-Cookie') ?? '')?.[1]
    expect(isRawDeviceId(raw)).toBe(true)
    expect(raw).not.toContain('script')
  })

  it('hai lượt vào liên tiếp (cùng cookie) cho vé khác nhau nhưng cùng mã thiết bị', async () => {
    const t = make({ extra: { SYNC_TOKEN: SECRET } })
    const h = { ...html, Cookie: `${DEVICE_COOKIE}=${RAW}` }
    const a = ticketOf(await t.get('/', h)).get(DEVICE_HANDOFF_PARAM)
    const b = ticketOf(await t.get('/', h)).get(DEVICE_HANDOFF_PARAM)
    expect(a).not.toBe(b)
    expect((await openDeviceHandoff(SECRET, a ?? '', nowSec()))?.raw).toBe(RAW)
    expect((await openDeviceHandoff(SECRET, b ?? '', nowSec()))?.raw).toBe(RAW)
  })

  it('tunnel đổi địa chỉ: vẫn cùng mã thiết bị trong vé', async () => {
    const h = { ...html, Cookie: `${DEVICE_COOKIE}=${RAW}` }
    const one = make({
      learned: 'https://aaa-111.trycloudflare.com',
      extra: { SYNC_TOKEN: SECRET },
    })
    const two = make({
      learned: 'https://bbb-222.trycloudflare.com',
      extra: { SYNC_TOKEN: SECRET },
    })
    const r1 = await one.get('/', h)
    const r2 = await two.get('/', h)
    expect(r1.headers.get('Location')).toContain('aaa-111')
    expect(r2.headers.get('Location')).toContain('bbb-222')
    const o1 = await openDeviceHandoff(
      SECRET,
      ticketOf(r1).get(DEVICE_HANDOFF_PARAM) ?? '',
      nowSec(),
    )
    const o2 = await openDeviceHandoff(
      SECRET,
      ticketOf(r2).get(DEVICE_HANDOFF_PARAM) ?? '',
      nowSec(),
    )
    expect(o1?.raw).toBe(o2?.raw)
  })

  it('chưa cấu hình SYNC_TOKEN: chuyển hướng như cũ, không vé, không cookie', async () => {
    const t = make()
    const res = await t.get('/links/3?tab=live')
    expect(res.headers.get('Location')).toBe(`${TUNNEL}/links/3?tab=live`)
    expect(res.headers.get('Set-Cookie')).toBeNull()
  })

  it('tunnel chết hoặc ?az_stay=1: Worker tự phục vụ giao diện, không cấp cookie thiết bị', async () => {
    const dead = make({ alive: false, extra: { SYNC_TOKEN: SECRET } })
    expect((await dead.get('/')).headers.get('Set-Cookie')).toBeNull()
    const stay = make({ extra: { SYNC_TOKEN: SECRET } })
    const res = await stay.get(`/?${PAGE_STAY_PARAM}=1`)
    expect(res.status).toBe(200)
    expect(res.headers.get('Set-Cookie')).toBeNull()
  })

  it('đường /api không bị đụng tới', async () => {
    const t = make({ extra: { SYNC_TOKEN: SECRET } })
    const res = await t.get('/api/khong-co', { Accept: 'application/json' })
    expect(res.status).not.toBe(302)
    expect(res.headers.get('Location')).toBeNull()
    expect(res.headers.get('Set-Cookie')).toBeNull()
  })
})
