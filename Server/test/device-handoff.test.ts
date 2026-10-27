import type { AddressInfo } from 'node:net'
import { DatabaseSync } from 'node:sqlite'
import {
  DEVICE_COOKIE,
  DEVICE_HANDOFF_PARAM,
  DEVICE_HANDOFF_TTL_SEC,
  DEVICE_ID_HEADER,
} from '@az-sentinel/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { sealDeviceHandoff } from '../../BE/src/edge/device-handoff'
import { applyEdgeClientIp } from '../../BE/src/edge/edge-sign'
import { HandoffNonces, handleDeviceHandoff } from '../src/device-handoff'
import { hashDeviceId } from '../src/device-id'
import { startHttpServer } from '../src/http'
import { IpGuard } from '../src/ip-guard'

const SECRET = 'sync-token-0123456789-abcdefghijkl'
const RAW = 'AbCdEfGhIjKlMnOpQrStUvWx'
const OUTSIDE = '198.51.100.7'
const browserApi = { 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' }
const nowSec = () => Math.floor(Date.now() / 1000)

describe('handleDeviceHandoff (đơn vị)', () => {
  const call = async (
    path: string,
    headers: Record<string, string> = {},
    secret = SECRET,
    nonces = new HandoffNonces(),
    at = nowSec(),
  ) => handleDeviceHandoff(new URL(`https://t.example${path}`), headers, secret, nonces, at)

  it('không có tham số vé: trả null (request đi tiếp bình thường)', async () => {
    expect(await call('/links?tab=1')).toBeNull()
  })

  it('vé hợp lệ: cấp cookie đúng mã, đường dẫn sạch, giữ các query khác', async () => {
    const t = await sealDeviceHandoff(SECRET, RAW, nowSec())
    const out = await call(`/links/3?tab=live&${DEVICE_HANDOFF_PARAM}=${t}&x=1`)
    expect(out?.location).toBe('/links/3?tab=live&x=1')
    expect(out?.setCookie).toMatch(new RegExp(`^${DEVICE_COOKIE}=${RAW};`))
  })

  it('đã có đúng cookie đó thì không cấp lại, vẫn gỡ vé khỏi URL', async () => {
    const t = await sealDeviceHandoff(SECRET, RAW, nowSec())
    const out = await call(`/?${DEVICE_HANDOFF_PARAM}=${t}`, { cookie: `${DEVICE_COOKIE}=${RAW}` })
    expect(out).toEqual({ location: '/', setCookie: null })
  })

  it('cookie cũ khác mã: bị thay bằng mã của Worker (hội tụ về một thiết bị)', async () => {
    const t = await sealDeviceHandoff(SECRET, RAW, nowSec())
    const out = await call(`/?${DEVICE_HANDOFF_PARAM}=${t}`, {
      cookie: `${DEVICE_COOKIE}=zzzzzzzzzzzzzzzzzzzzzzzz`,
    })
    expect(out?.setCookie).toContain(`${DEVICE_COOKIE}=${RAW}`)
  })

  it('vé dùng lại lần hai: vẫn chuyển hướng sạch nhưng KHÔNG cấp cookie', async () => {
    const nonces = new HandoffNonces()
    const t = await sealDeviceHandoff(SECRET, RAW, nowSec())
    const url = `/?${DEVICE_HANDOFF_PARAM}=${t}`
    expect((await call(url, {}, SECRET, nonces))?.setCookie).not.toBeNull()
    expect(await call(url, {}, SECRET, nonces)).toEqual({ location: '/', setCookie: null })
  })

  it('vé hết hạn, sai khóa, rác hoặc Server chưa có secret: không cấp cookie nhưng vẫn gỡ vé', async () => {
    const old = await sealDeviceHandoff(SECRET, RAW, nowSec() - DEVICE_HANDOFF_TTL_SEC - 10)
    const good = await sealDeviceHandoff(SECRET, RAW, nowSec())
    for (const [token, secret] of [
      [old, SECRET],
      [good, 'khoa-khac-0123456789-abcdefghijkl'],
      ['rac', SECRET],
      [good, ''],
    ] as const) {
      expect(await call(`/p?${DEVICE_HANDOFF_PARAM}=${token}`, {}, secret)).toEqual({
        location: '/p',
        setCookie: null,
      })
    }
  })

  it('đi qua HTTPS (x-forwarded-proto) thì cookie có Secure', async () => {
    const t = await sealDeviceHandoff(SECRET, RAW, nowSec())
    const out = await call(`/?${DEVICE_HANDOFF_PARAM}=${t}`, { 'x-forwarded-proto': 'https' })
    expect(out?.setCookie).toContain('; Secure')
  })

  it('kho nonce tự dọn vé hết hạn', () => {
    const n = new HandoffNonces()
    expect(n.take('a', 100, 50)).toBe(true)
    expect(n.take('a', 100, 60)).toBe(false)
    expect(n.take('a', 100, 101)).toBe(true) // đã hết hạn nên được dọn, dùng lại tên cũ không vướng
  })
})

describe('trao mã thiết bị qua máy chủ HTTP thật: tunnel đổi địa chỉ vẫn là một thiết bị', () => {
  const servers: ReturnType<typeof startHttpServer>[] = []
  afterEach(() => {
    for (const s of servers.splice(0)) s.close()
  })

  async function boot() {
    const db = new DatabaseSync(':memory:')
    db.exec(`
      CREATE TABLE server_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at INTEGER);
      CREATE TABLE ip_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT NOT NULL UNIQUE, label TEXT NOT NULL DEFAULT '', max_conns INTEGER NOT NULL DEFAULT 5, created_by INTEGER, created_at INTEGER NOT NULL, device_id TEXT);
      CREATE TABLE ip_blocked (ip TEXT PRIMARY KEY, last_at INTEGER NOT NULL, count INTEGER NOT NULL DEFAULT 1, device_id TEXT) WITHOUT ROWID;
      CREATE TABLE device_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL DEFAULT 'web', label TEXT NOT NULL DEFAULT '', mode TEXT NOT NULL DEFAULT 'device_only', last_ip TEXT, last_seen INTEGER, created_by INTEGER, created_at INTEGER NOT NULL);
      CREATE TABLE device_pending (device_id TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'web', ip TEXT NOT NULL DEFAULT '', user_agent TEXT NOT NULL DEFAULT '', last_at INTEGER NOT NULL, count INTEGER NOT NULL DEFAULT 1) WITHOUT ROWID;
      INSERT INTO server_meta (k, v) VALUES ('device_guard', '1');
    `)
    const guard = new IpGuard(db, () => Date.now() + 10_000)
    const seen: { deviceId?: string | null } = {}
    const server = startHttpServer({
      port: 0,
      host: '127.0.0.1',
      guard,
      edgeSecret: SECRET,
      handler: (req) => {
        seen.deviceId = req.headers.get(DEVICE_ID_HEADER)
        return Response.json({ ok: true })
      },
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.on('listening', () => resolve()))
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    return { url, seen, db }
  }

  async function fromIp(extra: Record<string, string> = {}) {
    const h = new Headers(extra)
    await applyEdgeClientIp(h, OUTSIDE, SECRET, nowSec())
    return Object.fromEntries(h.entries())
  }

  it('hai tunnel khác nhau (hai máy chủ) nhận cùng mã từ Worker thì cùng một thiết bị đã duyệt', async () => {
    const a = await boot()
    const b = await boot()
    const hashed = hashDeviceId(RAW)
    for (const t of [a, b]) {
      t.db
        .prepare('INSERT INTO device_rules (device_id, mode, created_at) VALUES (?, ?, 0)')
        .run(hashed, 'device_only')
    }

    for (const t of [a, b]) {
      const ticket = await sealDeviceHandoff(SECRET, RAW, nowSec())
      const hop = await fetch(`${t.url}/links?${DEVICE_HANDOFF_PARAM}=${ticket}`, {
        redirect: 'manual',
        headers: await fromIp({ 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' }),
      })
      expect(hop.status).toBe(302)
      expect(hop.headers.get('location')).toBe('/links') // vé không còn trên URL
      expect(hop.headers.get('cache-control')).toBe('no-store')
      const cookie = (hop.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
      expect(cookie).toBe(`${DEVICE_COOKIE}=${RAW}`)

      const ok = await fetch(`${t.url}/api/me`, {
        headers: await fromIp({ ...browserApi, cookie }),
      })
      expect(ok.status).toBe(200)
      expect(t.seen.deviceId).toBe(hashed)
    }
  })

  it('không qua Worker (không vé): vẫn tự cấp cookie như trước, thiết bị mới và bị chặn tới khi duyệt', async () => {
    const t = await boot()
    const res = await fetch(`${t.url}/api/me`, { headers: await fromIp(browserApi) })
    expect(res.status).toBe(403)
    const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
    expect(cookie).toMatch(/^az_dev=/)
    expect(cookie).not.toContain(RAW)
  })

  it('vé giả (ký bằng khóa khác) không cấp được cookie của thiết bị đã duyệt', async () => {
    const t = await boot()
    t.db
      .prepare('INSERT INTO device_rules (device_id, mode, created_at) VALUES (?, ?, 0)')
      .run(hashDeviceId(RAW), 'device_only')
    const forged = await sealDeviceHandoff('khoa-khac-0123456789-abcdefghijkl', RAW, nowSec())
    const hop = await fetch(`${t.url}/?${DEVICE_HANDOFF_PARAM}=${forged}`, {
      redirect: 'manual',
      headers: await fromIp({ 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' }),
    })
    expect(hop.status).toBe(302)
    expect(hop.headers.get('set-cookie')).toBeNull()
  })

  it('vé chỉ dùng được một lần ngay trên máy chủ thật', async () => {
    const t = await boot()
    const ticket = await sealDeviceHandoff(SECRET, RAW, nowSec())
    const get = async () =>
      fetch(`${t.url}/?${DEVICE_HANDOFF_PARAM}=${ticket}`, {
        redirect: 'manual',
        headers: await fromIp({ 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' }),
      })
    expect((await get()).headers.get('set-cookie')).toContain(RAW)
    expect((await get()).headers.get('set-cookie')).toBeNull()
  })
})
