import { env } from 'cloudflare:workers'
import { decodeConnectCode, SERVED_BY_HEADER, type ServerNode } from '@az-sentinel/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app'
import type { FetchFn } from '../../src/edge/timed-fetch'
import { VpsOriginStore } from '../../src/edge/vps-origin'
import { buildConnectCode } from '../../src/routes/admin-tokens'
import type { Bindings } from '../../src/types'
import { resetDb, seedToken } from '../helpers'

/**
 * Các phần tự động hóa chạy CÙNG NHAU (Quick Tunnel + danh bạ + dự phòng + giao diện): kiểm những chỗ chúng giao nhau.
 */
const TOKEN = 'sync-token-0123456789'
const WORKER = 'https://az-sentinel-api.acc.workers.dev'
const TUNNEL = 'https://new-lake-222.trycloudflare.com'
const baseEnv = { DB: env.DB, LIVE_HUB: env.LIVE_HUB, SYNC_TOKEN: TOKEN, DEV_LINKS_API: '1' }
const GW_TOKEN = 'azt_0123456789abcdef0123456789abcdef'
const viewer = { Cookie: 'az_mock_session=admin@az.local' }

const node: ServerNode = {
  role: 'vps',
  name: 'VPS',
  host: null,
  os: null,
  arch: null,
  runtime: 'node',
  version: '0.1.0',
  startedAt: 1,
  uptimeSec: 1,
  cpuCount: null,
  memTotalMb: null,
  memFreeMb: null,
  cpuPct: null,
  location: null,
}

function make(alive: string[]) {
  const calls: string[] = []
  const fetchFn: FetchFn = async (input) => {
    const url = new URL(input)
    if (!alive.includes(url.origin)) throw new Error('down')
    calls.push(`${url.origin}${url.pathname}`)
    return Response.json({ ok: true }, { headers: { [SERVED_BY_HEADER]: 'vps' } })
  }
  const origins = new VpsOriginStore()
  const app = createApp({ edge: { fetchFn, registry: new Map(), origins } })
  const req = (path: string, headers: Record<string, string> = {}, e: object = baseEnv) =>
    app.fetch(new Request(`http://az.test${path}`, { headers }), e)
  const beat = (tunnelUrl: string | null) =>
    app.fetch(
      new Request('http://az.test/api/sync/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ node, sentAt: 1, tunnelUrl }),
      }),
      baseEnv,
    )
  return { req, beat, calls }
}

beforeEach(async () => {
  await resetDb()
  await env.DB.prepare("DELETE FROM server_meta WHERE k = 'vps_tunnel_origin'").run()
})

describe('mã kết nối Gateway trong cấu hình Quick Tunnel', () => {
  it('Server đặt PRIMARY_URL = FALLBACK_URL = địa chỉ Worker: mã chỉ mang MỘT địa chỉ (không nối lại chính mình)', () => {
    const e = { PRIMARY_URL: WORKER, FALLBACK_URL: WORKER } as Bindings
    const code = buildConnectCode(e, 'http://127.0.0.1:8080/api/admin', GW_TOKEN)
    expect(decodeConnectCode(code as string)).toEqual({
      primaryUrl: 'wss://az-sentinel-api.acc.workers.dev/api/gw/ws',
      fallbackUrl: '',
      token: GW_TOKEN,
    })
  })

  it('tunnel có tên (địa chỉ chính là VPS) + Worker dự phòng: giữ cả hai địa chỉ', () => {
    const e = { PRIMARY_URL: 'https://az.example.com', FALLBACK_URL: WORKER } as Bindings
    const p = decodeConnectCode(buildConnectCode(e, 'http://x/', GW_TOKEN) as string)
    expect(p?.primaryUrl).toBe('wss://az.example.com/api/gw/ws')
    expect(p?.fallbackUrl).toBe('wss://az-sentinel-api.acc.workers.dev/api/gw/ws')
  })
})

describe('danh bạ tunnel và bộ định tuyến cùng tồn tại', () => {
  it('người dùng tunnel có tên (không báo tunnelUrl): danh bạ trả VPS_ORIGIN cấu hình tay', async () => {
    const { token } = await seedToken(7)
    const t = make([])
    const res = await t.req(
      '/api/gw/tunnel',
      { Authorization: `Bearer ${token}` },
      { ...baseEnv, VPS_ORIGIN: 'https://az.example.com' },
    )
    expect(await res.json()).toMatchObject({
      ok: true,
      origin: 'https://az.example.com',
      wsUrl: 'wss://az.example.com/api/gw/ws',
    })
  })

  it('VPS khởi động lại chưa có tunnel (nhịp sống không kèm địa chỉ): giữ địa chỉ cũ cho tới khi có địa chỉ mới', async () => {
    const { token } = await seedToken(7)
    const t = make([TUNNEL])
    await t.beat(TUNNEL)
    const before = (await (
      await t.req('/api/gw/tunnel', { Authorization: `Bearer ${token}` })
    ).json()) as { origin: string }
    expect(before.origin).toBe(TUNNEL)
  })

  it('server-info khi VPS sập: vẫn chỉ ra địa chỉ tunnel gần nhất, không nhầm với PRIMARY_URL cũ đặt tay', async () => {
    const t = make([])
    await t.beat(TUNNEL)
    const e = { ...baseEnv, PRIMARY_URL: 'https://cu.example.com' }
    const info = (await (await t.req('/api/server-info', viewer, e)).json()) as {
      mode: string
      primaryUrl: string
      primary: { status: string }
    }
    expect(info).toMatchObject({ mode: 'fallback', primaryUrl: TUNNEL })
    expect(info.primary.status).toBe('down')
  })

  it('đang dự phòng thì /api/health, /api/gw/tunnel và /api/server-info do Worker tự trả lời, không chạm VPS đã chết', async () => {
    const { token } = await seedToken(7)
    const t = make([])
    await t.beat(TUNNEL)
    for (const [path, headers] of [
      ['/api/gw/tunnel', { Authorization: `Bearer ${token}` }],
      ['/api/server-info', viewer],
    ] as const) {
      const res = await t.req(path, { ...headers })
      expect(res.status).toBe(200)
    }
    expect(t.calls).toEqual([])
  })

  it('API không tồn tại trả JSON 404 (không rơi vào giao diện tĩnh của Worker)', async () => {
    const t = make([])
    const res = await t.req('/api/khong-co-route')
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toContain('application/json')
  })
})
