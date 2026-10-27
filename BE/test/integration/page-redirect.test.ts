import { env } from 'cloudflare:workers'
import { PAGE_STAY_PARAM, SERVED_BY_HEADER } from '@az-sentinel/shared'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/app'
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
