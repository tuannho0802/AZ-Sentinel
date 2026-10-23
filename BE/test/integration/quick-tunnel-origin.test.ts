import { env } from 'cloudflare:workers'
import {
  EDGE_IP_HEADER,
  EDGE_SIG_HEADER,
  EDGE_TS_HEADER,
  SERVED_BY_HEADER,
  type ServerNode,
} from '@az-sentinel/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app'
import type { FetchFn } from '../../src/edge/timed-fetch'
import { VpsOriginStore } from '../../src/edge/vps-origin'
import { resetDb, seedToken } from '../helpers'

const TOKEN = 'sync-token-0123456789'
const baseEnv = { DB: env.DB, LIVE_HUB: env.LIVE_HUB, SYNC_TOKEN: TOKEN }
const auth = { Authorization: `Bearer ${TOKEN}` }
const NEW = 'https://new-lake-222.trycloudflare.com'
const OLD = 'https://old-lake-111.trycloudflare.com'

const vpsNode: ServerNode = {
  role: 'vps',
  name: 'VPS-MAIN',
  host: 'WIN-ABC',
  os: 'Windows Server 2022',
  arch: 'x64',
  runtime: 'node v22.22.2',
  version: '0.1.0',
  startedAt: 1_700_000_000,
  uptimeSec: 7200,
  cpuCount: 4,
  memTotalMb: 8192,
  memFreeMb: 3000,
  cpuPct: 20,
  location: null,
}

/** VPS giả theo từng origin: ghi lại request đã tới; origin nào không có trong `alive` thì "sập". */
function fakeVps(alive: string[]) {
  const calls: { origin: string; path: string; headers: Headers }[] = []
  const fetchFn: FetchFn = async (input, init) => {
    const url = new URL(input)
    if (!alive.includes(url.origin)) throw new Error('down')
    calls.push({ origin: url.origin, path: url.pathname, headers: new Headers(init?.headers) })
    const headers = { [SERVED_BY_HEADER]: 'vps' }
    return url.pathname === '/api/health'
      ? Response.json({ status: 'ok' }, { headers })
      : Response.json({ from: url.origin }, { headers })
  }
  return { fetchFn, calls }
}

function make(alive: string[]) {
  const vps = fakeVps(alive)
  const origins = new VpsOriginStore()
  const app = createApp({ edge: { fetchFn: vps.fetchFn, registry: new Map(), origins } })
  const beat = (body: Record<string, unknown>, headers: Record<string, string> = auth) =>
    app.fetch(
      new Request('http://az.test/api/sync/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ node: vpsNode, sentAt: 1, ...body }),
      }),
      baseEnv,
    )
  const get = (path: string, e: object = baseEnv, headers: Record<string, string> = {}) =>
    app.fetch(new Request(`http://az.test${path}`, { headers }), e)
  return { vps, origins, app, beat, get }
}

beforeEach(async () => {
  await resetDb()
  await env.DB.prepare("DELETE FROM server_meta WHERE k = 'vps_tunnel_origin'").run()
})

describe('Quick Tunnel: Worker tự theo địa chỉ VPS báo lên (Plan 3G)', () => {
  it('chưa có địa chỉ nào: chạy một mình (standalone); VPS báo địa chỉ xong thì chuyển tiếp sang đó', async () => {
    const t = make([NEW])
    const before = await t.get('/api/ea/v1/gate')
    expect(before.headers.get(SERVED_BY_HEADER)).toBe('cloudflare')

    expect((await t.beat({ tunnelUrl: NEW })).status).toBe(200)
    const res = await t.get('/api/ea/v1/gate')
    expect(await res.json()).toEqual({ from: NEW })
    expect(res.headers.get(SERVED_BY_HEADER)).toBe('vps')
  })

  it('VPS reset, địa chỉ ĐỔI: sau nhịp sống mới Worker chuyển sang địa chỉ mới, không gọi địa chỉ cũ nữa', async () => {
    const t = make([OLD, NEW])
    await t.beat({ tunnelUrl: OLD })
    expect(await (await t.get('/api/x')).json()).toEqual({ from: OLD })

    await t.beat({ tunnelUrl: NEW })
    t.vps.calls.length = 0
    expect(await (await t.get('/api/x')).json()).toEqual({ from: NEW })
    expect(t.vps.calls.every((c) => c.origin === NEW)).toBe(true)
  })

  it('địa chỉ cũ đã chết và VPS chưa kịp báo mới: Worker tự chạy dự phòng, báo mới xong thì quay về VPS', async () => {
    const t = make([NEW])
    await t.beat({ tunnelUrl: OLD })
    const down = await t.get('/api/x')
    expect(down.headers.get(SERVED_BY_HEADER)).toBe('cloudflare')

    await t.beat({ tunnelUrl: NEW })
    expect(await (await t.get('/api/x')).json()).toEqual({ from: NEW })
  })

  it('isolate khác (đệm mới) vẫn đọc đúng địa chỉ từ D1', async () => {
    const a = make([NEW])
    await a.beat({ tunnelUrl: NEW })
    const b = make([NEW])
    expect(await (await b.get('/api/x')).json()).toEqual({ from: NEW })
  })

  it('địa chỉ báo lên thắng VPS_ORIGIN cấu hình tay; báo null thì quay về VPS_ORIGIN', async () => {
    const FIXED = 'https://fixed.example.com'
    const t = make([NEW, FIXED])
    const withFixed = { ...baseEnv, VPS_ORIGIN: FIXED }
    expect(await (await t.get('/api/x', withFixed)).json()).toEqual({ from: FIXED })
    await t.beat({ tunnelUrl: NEW })
    expect(await (await t.get('/api/x', withFixed)).json()).toEqual({ from: NEW })
    await t.beat({ tunnelUrl: null })
    expect(await (await t.get('/api/x', withFixed)).json()).toEqual({ from: FIXED })
  })

  it('không gửi tunnelUrl (VPS cũ) thì giữ nguyên địa chỉ đã nhớ', async () => {
    const t = make([NEW])
    await t.beat({ tunnelUrl: NEW })
    await t.beat({})
    expect(await (await t.get('/api/x')).json()).toEqual({ from: NEW })
  })

  it('từ chối địa chỉ không an toàn và yêu cầu không có token', async () => {
    const t = make([NEW])
    for (const bad of [
      'http://abc.trycloudflare.com',
      'https://127.0.0.1',
      'https://localhost',
      'https://10.0.0.5:8443',
      'https://u:p@abc.trycloudflare.com',
      'khong-phai-url',
    ]) {
      expect((await t.beat({ tunnelUrl: bad })).status, bad).toBe(400)
    }
    expect((await t.beat({ tunnelUrl: NEW }, {})).status).toBe(401)
    const row = await env.DB.prepare(
      "SELECT v FROM server_meta WHERE k = 'vps_tunnel_origin'",
    ).first()
    expect(row).toBeNull()
  })

  it('chuyển IP thật kèm chữ ký HMAC sang VPS, client tự đặt header đó thì bị ghi đè', async () => {
    const t = make([NEW])
    await t.beat({ tunnelUrl: NEW })
    await t.get('/api/x', baseEnv, {
      'CF-Connecting-IP': '203.0.113.9',
      [EDGE_IP_HEADER]: '1.1.1.1',
      [EDGE_SIG_HEADER]: 'gia',
      [EDGE_TS_HEADER]: '1',
    })
    const fwd = t.vps.calls.find((c) => c.path === '/api/x')
    expect(fwd?.headers.get(EDGE_IP_HEADER)).toBe('203.0.113.9')
    expect(fwd?.headers.get(EDGE_SIG_HEADER)).toMatch(/^[0-9a-f]{64}$/)
    expect(Number(fwd?.headers.get(EDGE_TS_HEADER))).toBeGreaterThan(1_700_000_000)
  })

  it('không có SYNC_TOKEN thì chỉ chuyển IP, không ký', async () => {
    const t = make([NEW])
    await t.beat({ tunnelUrl: NEW })
    const noSecret = { DB: env.DB, LIVE_HUB: env.LIVE_HUB, VPS_ORIGIN: NEW }
    await t.get('/api/y', noSecret, { 'CF-Connecting-IP': '203.0.113.9' })
    const fwd = t.vps.calls.find((c) => c.path === '/api/y')
    expect(fwd?.headers.get(EDGE_IP_HEADER)).toBe('203.0.113.9')
    expect(fwd?.headers.get(EDGE_SIG_HEADER)).toBeNull()
  })
})

describe('Danh bạ tunnel cho Gateway: GET /api/gw/tunnel (Plan 3H)', () => {
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` })

  it('cần token Gateway: thiếu hoặc sai thì 401, không lộ địa chỉ tunnel', async () => {
    const t = make([NEW])
    await t.beat({ tunnelUrl: NEW })
    expect((await t.get('/api/gw/tunnel')).status).toBe(401)
    expect(
      (await t.get('/api/gw/tunnel', baseEnv, bearer('azt_sai-0123456789abcdef'))).status,
    ).toBe(401)
    // SYNC_TOKEN không thay được token Gateway
    expect((await t.get('/api/gw/tunnel', baseEnv, auth)).status).toBe(401)
  })

  it('có token: trả địa chỉ tunnel VPS đã báo và địa chỉ WebSocket tương ứng, không đệm', async () => {
    const t = make([NEW])
    const { token } = await seedToken(7)
    const none = await t.get('/api/gw/tunnel', baseEnv, bearer(token))
    expect(await none.json()).toEqual({ ok: true, origin: null, wsUrl: null })

    await t.beat({ tunnelUrl: NEW })
    const res = await t.get('/api/gw/tunnel', baseEnv, bearer(token))
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.json()).toEqual({
      ok: true,
      origin: NEW,
      wsUrl: 'wss://new-lake-222.trycloudflare.com/api/gw/ws',
    })
  })

  it('VPS reset đổi địa chỉ: danh bạ trả địa chỉ mới ngay', async () => {
    const t = make([OLD, NEW])
    const { token } = await seedToken(7)
    await t.beat({ tunnelUrl: OLD })
    expect(
      ((await (await t.get('/api/gw/tunnel', baseEnv, bearer(token))).json()) as { origin: string })
        .origin,
    ).toBe(OLD)
    await t.beat({ tunnelUrl: NEW })
    expect(
      ((await (await t.get('/api/gw/tunnel', baseEnv, bearer(token))).json()) as { origin: string })
        .origin,
    ).toBe(NEW)
  })

  it('luôn do Worker tự trả lời, không chuyển tiếp sang VPS (không tốn lượt VPS, không lộ token)', async () => {
    const t = make([NEW])
    const { token } = await seedToken(7)
    await t.beat({ tunnelUrl: NEW })
    t.vps.calls.length = 0
    await t.get('/api/gw/tunnel', baseEnv, bearer(token))
    expect(t.vps.calls.filter((c) => c.path === '/api/gw/tunnel')).toHaveLength(0)
  })
})
