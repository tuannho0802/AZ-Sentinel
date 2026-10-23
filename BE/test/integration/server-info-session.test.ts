import { env } from 'cloudflare:workers'
import { EDGE_IP_HEADER, EDGE_SIG_HEADER, SERVED_BY_HEADER } from '@az-sentinel/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app'
import type { FetchFn } from '../../src/edge/timed-fetch'
import { resetDb } from '../helpers'

// Khi VPS là máy chủ chính, phiên đăng nhập nằm trong CSDL của VPS. `/api/server-info` do Worker tự xử lý (chỉ tra D1 của
// Worker) nên trước đây người đã đăng nhập qua VPS vẫn bị 401 ở đúng route này.
const TOKEN = 'sync-token-0123456789'
const ORIGIN = 'https://vps.test'
const SESSION = { Cookie: 'az_session=phien-cua-vps', 'CF-Connecting-IP': '203.0.113.7' }
const baseEnv = { DB: env.DB, LIVE_HUB: env.LIVE_HUB, SYNC_TOKEN: TOKEN, VPS_ORIGIN: ORIGIN }

const selfBody = {
  node: {
    role: 'vps',
    name: 'VPS-MAIN',
    host: 'WIN-ABC',
    os: 'Windows Server 2012 R2',
    arch: 'x64',
    runtime: 'node v24.22.1',
    version: '0.2.2',
    startedAt: 1_700_000_000,
    uptimeSec: 60,
    cpuCount: 2,
    memTotalMb: 2047,
    memFreeMb: 418,
    cpuPct: 20,
    location: null,
  },
  standby: null,
  fallbackUrl: null,
  gateways: 0,
  viewers: 0,
}

function vps(meStatus: number, seen: Request[] = []): FetchFn {
  return async (input, init) => {
    seen.push(new Request(input, init))
    const h = { [SERVED_BY_HEADER]: 'vps' }
    if (input.endsWith('/api/health')) return Response.json({ status: 'ok' }, { headers: h })
    if (input.endsWith('/api/me')) {
      return meStatus === 200
        ? Response.json({ id: 1, email: 'a@b.c', display_name: 'A', role: 'root_admin' })
        : Response.json({ error: { code: 'UNAUTHENTICATED' } }, { status: meStatus })
    }
    return Response.json(selfBody, { headers: h })
  }
}

beforeEach(async () => {
  await resetDb()
})

describe('/api/server-info khi phiên đăng nhập nằm ở VPS', () => {
  it('cookie không có ở D1 của Worker nhưng VPS xác nhận: 200, hỏi VPS kèm IP thật có chữ ký', async () => {
    const seen: Request[] = []
    const app = createApp({ edge: { fetchFn: vps(200, seen), registry: new Map() } })
    const res = await app.fetch(
      new Request('http://az.test/api/server-info', { headers: SESSION }),
      baseEnv,
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ mode: 'primary', active: { name: 'VPS-MAIN' } })
    const me = seen.find((r) => r.url === `${ORIGIN}/api/me`)
    expect(me?.headers.get('Cookie')).toBe(SESSION.Cookie)
    expect(me?.headers.get(EDGE_IP_HEADER)).toBe('203.0.113.7')
    expect(me?.headers.get(EDGE_SIG_HEADER)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('VPS từ chối phiên (401): vẫn 401', async () => {
    const app = createApp({ edge: { fetchFn: vps(401), registry: new Map() } })
    const res = await app.fetch(
      new Request('http://az.test/api/server-info', { headers: SESSION }),
      baseEnv,
    )
    expect(res.status).toBe(401)
  })

  it('không có cookie: 401 và không hỏi VPS', async () => {
    const seen: Request[] = []
    const app = createApp({ edge: { fetchFn: vps(200, seen), registry: new Map() } })
    const res = await app.fetch(new Request('http://az.test/api/server-info'), baseEnv)
    expect(res.status).toBe(401)
    expect(seen.some((r) => r.url.endsWith('/api/me'))).toBe(false)
  })

  it('không cấu hình VPS: không hỏi đâu cả, cookie lạ vẫn 401', async () => {
    const seen: Request[] = []
    const app = createApp({ edge: { fetchFn: vps(200, seen), registry: new Map() } })
    const { VPS_ORIGIN: _omit, ...noVps } = baseEnv
    const res = await app.fetch(
      new Request('http://az.test/api/server-info', { headers: SESSION }),
      noVps,
    )
    expect(res.status).toBe(401)
    expect(seen).toHaveLength(0)
  })
})
