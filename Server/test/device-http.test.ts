import type { AddressInfo } from 'node:net'
import { DatabaseSync } from 'node:sqlite'
import { DEVICE_HEADER, DEVICE_ID_HEADER } from '@az-sentinel/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { applyEdgeClientIp } from '../../BE/src/edge/edge-sign'
import { hashDeviceId } from '../src/device-id'
import { startHttpServer } from '../src/http'
import { IpGuard } from '../src/ip-guard'

const SECRET = 'sync-token-0123456789-abcdefghijkl'
const RAW = 'AbCdEfGhIjKlMnOpQrStUvWx'
const RAW2 = 'zzzzzzzzzzzzzzzzzzzzzzzz'
const OUTSIDE = '198.51.100.7'
const browserApi = { 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' }

/** Header do Worker ký (IP thật khác loopback), nếu không IP 127.0.0.1 luôn được miễn xét. */
async function fromIp(ip: string, extra: Record<string, string> = {}) {
  const h = new Headers(extra)
  await applyEdgeClientIp(h, ip, SECRET, Math.floor(Date.now() / 1000))
  return Object.fromEntries(h.entries())
}

describe('Whitelist thiết bị qua máy chủ HTTP thật', () => {
  const servers: ReturnType<typeof startHttpServer>[] = []
  afterEach(() => {
    for (const s of servers.splice(0)) s.close()
  })

  async function boot(opts: { ip?: boolean; device?: boolean } = {}) {
    const db = new DatabaseSync(':memory:')
    db.exec(`
      CREATE TABLE server_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at INTEGER);
      CREATE TABLE ip_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT NOT NULL UNIQUE, label TEXT NOT NULL DEFAULT '', max_conns INTEGER NOT NULL DEFAULT 5, created_by INTEGER, created_at INTEGER NOT NULL, device_id TEXT);
      CREATE TABLE ip_blocked (ip TEXT PRIMARY KEY, last_at INTEGER NOT NULL, count INTEGER NOT NULL DEFAULT 1, device_id TEXT) WITHOUT ROWID;
      CREATE TABLE device_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL DEFAULT 'web', label TEXT NOT NULL DEFAULT '', mode TEXT NOT NULL DEFAULT 'device_only', last_ip TEXT, last_seen INTEGER, created_by INTEGER, created_at INTEGER NOT NULL);
      CREATE TABLE device_pending (device_id TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'web', ip TEXT NOT NULL DEFAULT '', user_agent TEXT NOT NULL DEFAULT '', last_at INTEGER NOT NULL, count INTEGER NOT NULL DEFAULT 1) WITHOUT ROWID;
    `)
    if (opts.ip) db.exec("INSERT INTO server_meta (k, v) VALUES ('ip_guard', '1')")
    if (opts.device) db.exec("INSERT INTO server_meta (k, v) VALUES ('device_guard', '1')")
    const clock = { t: Date.now() }
    const guard = new IpGuard(db, () => clock.t)
    const seen: Record<string, string | null> = {}
    const server = startHttpServer({
      port: 0,
      host: '127.0.0.1',
      guard,
      edgeSecret: SECRET,
      handler: (req) => {
        seen.deviceId = req.headers.get(DEVICE_ID_HEADER)
        seen.rawDevice = req.headers.get(DEVICE_HEADER)
        seen.cookie = req.headers.get('cookie')
        return Response.json({ ok: true })
      },
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.on('listening', () => resolve()))
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const approve = (id: string, mode = 'device_only') => {
      db.prepare('INSERT INTO device_rules (device_id, mode, created_at) VALUES (?, ?, 0)').run(
        id,
        mode,
      )
      clock.t += 6_000 // hết thời gian đệm 5 giây để luật mới có hiệu lực
    }
    const rows = <T = Record<string, unknown>>(sql: string) => db.prepare(sql).all() as T[]
    return { url, seen, approve, rows }
  }

  it('luồng đầy đủ qua Worker: bị chặn + nhận cookie -> hiện ở chờ duyệt -> duyệt -> vào được', async () => {
    const { url, approve, rows, seen } = await boot({ device: true })
    const first = await fetch(`${url}/api/me`, { headers: await fromIp(OUTSIDE, browserApi) })
    expect(first.status).toBe(403)
    const setCookie = first.headers.get('set-cookie') ?? ''
    expect(setCookie).toMatch(/^az_dev=/)
    const cookie = setCookie.split(';')[0] ?? ''
    const hashed = hashDeviceId(cookie.replace('az_dev=', ''))
    expect(rows<{ device_id: string }>('SELECT device_id FROM device_pending')).toEqual([
      { device_id: hashed },
    ])
    // Mã ngắn trong thông báo để người dùng đọc cho admin đối chiếu.
    expect(JSON.stringify(await first.json())).toContain(hashed.slice(0, 8))

    const again = await fetch(`${url}/api/me`, {
      headers: await fromIp(OUTSIDE, { ...browserApi, cookie }),
    })
    expect(again.status).toBe(403)
    expect(again.headers.get('set-cookie')).toBeNull() // đã có cookie thì không cấp lại

    approve(hashed)
    const ok = await fetch(`${url}/api/me`, {
      headers: await fromIp(OUTSIDE, { ...browserApi, cookie }),
    })
    expect(ok.status).toBe(200)
    expect(seen.deviceId).toBe(hashed)
  })

  it('máy chạy Server (loopback) vào được dù chưa có thiết bị nào được duyệt', async () => {
    const { url } = await boot({ device: true, ip: true })
    const res = await fetch(`${url}/api/me`)
    expect(res.status).toBe(200)
  })

  it('Gateway chỉ gửi header X-AZ-Device: thiết bị đã duyệt vào được, không được cấp cookie', async () => {
    const { url, approve, seen } = await boot({ device: true })
    approve(hashDeviceId(RAW), 'device_only')
    const res = await fetch(`${url}/api/ingest`, {
      headers: await fromIp(OUTSIDE, { [DEVICE_HEADER]: RAW }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(seen.deviceId).toBe(hashDeviceId(RAW))
  })

  it('Gateway cũ không gửi mã thiết bị: bị chặn và không nhận cookie (không phải trình duyệt)', async () => {
    const { url, rows } = await boot({ device: true })
    const res = await fetch(`${url}/api/ingest`, {
      headers: await fromIp(OUTSIDE, { accept: 'application/json' }),
    })
    expect(res.status).toBe(403)
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(JSON.stringify(await res.json())).toContain('Không nhận diện được thiết bị')
    expect(rows('SELECT * FROM device_pending')).toHaveLength(0)
  })

  it('giả mạo X-AZ-Device-Id (mã đã băm) của thiết bị được duyệt bị gỡ, BE thấy mã thật', async () => {
    const { url, approve, seen } = await boot({ device: true })
    approve(hashDeviceId(RAW))
    const forged = hashDeviceId(RAW2)
    const res = await fetch(`${url}/api/me`, {
      headers: await fromIp(OUTSIDE, {
        [DEVICE_HEADER]: RAW,
        [DEVICE_ID_HEADER]: forged,
      }),
    })
    expect(res.status).toBe(200)
    expect(seen.deviceId).toBe(hashDeviceId(RAW))
    expect(seen.rawDevice).toBeNull() // mã thô không bao giờ tới BE
  })

  it('tắt bảo vệ thiết bị: header giả vẫn bị gỡ, BE thấy không có mã thiết bị nào', async () => {
    const { url, seen } = await boot()
    const res = await fetch(`${url}/api/me`, {
      headers: await fromIp(OUTSIDE, { [DEVICE_ID_HEADER]: hashDeviceId(RAW2) }),
    })
    expect(res.status).toBe(200)
    expect(seen.deviceId).toBeNull()
  })

  it('cookie giả của người khác nhưng chưa duyệt thì vẫn bị chặn', async () => {
    const { url, approve } = await boot({ device: true })
    approve(hashDeviceId(RAW))
    const res = await fetch(`${url}/api/me`, {
      headers: await fromIp(OUTSIDE, { ...browserApi, cookie: `az_dev=${RAW2}` }),
    })
    expect(res.status).toBe(403)
  })

  it('thiết bị device_only đã duyệt nhưng IP chưa vào whitelist thì vẫn bị chặn (thông báo nói về IP)', async () => {
    const { url, approve } = await boot({ device: true, ip: true })
    approve(hashDeviceId(RAW), 'device_only')
    const res = await fetch(`${url}/api/me`, {
      headers: await fromIp(OUTSIDE, { [DEVICE_HEADER]: RAW }),
    })
    expect(res.status).toBe(403)
    expect(JSON.stringify(await res.json())).toContain('whitelist')
  })

  it('thiết bị any_ip đã duyệt: IP mới tự vào whitelist, lần sau vẫn vào được', async () => {
    const { url, approve, rows } = await boot({ device: true, ip: true })
    approve(hashDeviceId(RAW), 'any_ip')
    for (let i = 0; i < 2; i++) {
      const res = await fetch(`${url}/api/me`, {
        headers: await fromIp(OUTSIDE, { [DEVICE_HEADER]: RAW }),
      })
      expect(res.status).toBe(200)
    }
    expect(rows<{ ip: string }>('SELECT ip FROM ip_rules').map((r) => r.ip)).toEqual([OUTSIDE])
  })

  it('đi qua HTTPS (X-Forwarded-Proto) thì cookie mới có cờ Secure', async () => {
    const { url } = await boot({ device: true })
    const res = await fetch(`${url}/api/me`, {
      headers: await fromIp(OUTSIDE, { ...browserApi, 'x-forwarded-proto': 'https' }),
    })
    expect(res.headers.get('set-cookie')).toContain('Secure')
  })

  it('WebSocket: thiết bị chưa duyệt bị từ chối 403 và không được cấp cookie mới', async () => {
    const { url, rows } = await boot({ device: true })
    const headers = await fromIp(OUTSIDE, { cookie: `az_dev=${RAW}` })
    const status = await new Promise<{ code?: number; cookie: string | undefined }>((resolve) => {
      const ws = new WebSocket(url.replace('http', 'ws'), { headers })
      ws.on('unexpected-response', (_req, res) => {
        resolve({ code: res.statusCode, cookie: res.headers['set-cookie']?.[0] })
        ws.terminate()
      })
      ws.on('error', () => {})
    })
    expect(status.code).toBe(403)
    expect(status.cookie).toBeUndefined()
    // Nhưng vẫn ghi vào chờ duyệt để admin thấy thiết bị đang thử kết nối.
    expect(rows<{ device_id: string }>('SELECT device_id FROM device_pending')).toEqual([
      { device_id: hashDeviceId(RAW) },
    ])
  })

  it('WebSocket không mang mã thiết bị nào: bị từ chối 403', async () => {
    const { url } = await boot({ device: true })
    const headers = await fromIp(OUTSIDE)
    const code = await new Promise<number | undefined>((resolve) => {
      const ws = new WebSocket(url.replace('http', 'ws'), { headers })
      ws.on('unexpected-response', (_req, res) => {
        resolve(res.statusCode)
        ws.terminate()
      })
      ws.on('error', () => {})
    })
    expect(code).toBe(403)
  })
})
