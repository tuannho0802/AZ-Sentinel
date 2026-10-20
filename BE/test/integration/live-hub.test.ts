import { env } from 'cloudflare:workers'
import type { ServerMessage, UserRole } from '@az-sentinel/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app'
import type { LiveScope } from '../../src/live/hub-types'
import { scopeMatches } from '../../src/live/scope'
import type { Viewer } from '../../src/live/viewer-auth'
import { encodeViewer, VIEWER_HEADER } from '../../src/live/viewer-header'
import type { Bindings } from '../../src/types'
import { resetDb, seedLink, setOwner } from '../helpers'

const bindings = env as unknown as Bindings
const T0 = Date.now()
let hubSeq = 0
const hubFor = () => bindings.LIVE_HUB.getByName(`t-${Date.now()}-${++hubSeq}`)
type Hub = ReturnType<typeof hubFor>

type Conn = { ws: WebSocket; msgs: ServerMessage[] }
const open: WebSocket[] = []

function wrap(ws: WebSocket): Conn {
  const msgs: ServerMessage[] = []
  ws.accept()
  ws.addEventListener('message', (e) => {
    msgs.push(JSON.parse(String(e.data)) as ServerMessage)
  })
  open.push(ws)
  return { ws, msgs }
}

/** Mở WebSocket thẳng vào hub với `nowMs` giả để điều khiển đồng hồ (hub tin header nội bộ). */
async function connect(
  hub: Hub,
  o: { userId?: number; role?: UserRole; scope?: LiveScope; nowMs?: number; exp?: number } = {},
): Promise<Conn> {
  const viewer = encodeViewer({
    userId: o.userId ?? 1,
    role: o.role ?? 'user',
    scope: o.scope ?? { kind: 'owner', ownerId: o.userId ?? 1 },
    expiresAt: o.exp ?? null,
    nowMs: o.nowMs ?? T0,
  })
  const res = await hub.fetch(
    new Request('http://hub/', { headers: { Upgrade: 'websocket', [VIEWER_HEADER]: viewer } }),
  )
  if (!res.webSocket) throw new Error(`không nâng cấp được: ${res.status}`)
  return wrap(res.webSocket)
}

const until = async (fn: () => boolean, ms = 1500) => {
  const end = Date.now() + ms
  while (!fn()) {
    if (Date.now() > end) throw new Error('quá thời gian chờ')
    await new Promise((r) => setTimeout(r, 10))
  }
}
const tick = () => new Promise((r) => setTimeout(r, 30))
const hello = (c: Conn) => c.ws.send(JSON.stringify({ t: 'hello', scope: 'links' }))
const sample = (t: number) => ({ t, eq: 10100, bal: 10000, fl: 100, ml: null })
const base = (linkId: number, ownerId: number | null = 1) => ({ linkId, ownerId })
const pub = (hub: Hub, linkId: number, seq: number, nowMs: number, t: number, ownerId = 1) =>
  hub.publish({
    ref: base(linkId, ownerId),
    sid: 's',
    seq,
    samples: [sample(t)],
    nowMs,
  })

beforeEach(resetDb)
afterEach(async () => {
  for (const ws of open.splice(0)) {
    try {
      ws.close(1000)
    } catch {
      // đã đóng
    }
  }
  await tick()
})

describe('LiveHub: viewer và gate (B-22..B-25)', () => {
  it('B-22: đóng kết nối cuối cùng => shouldBeLive thành false ngay', async () => {
    const hub = hubFor()
    const c = await connect(hub)
    expect((await hub.shouldBeLive(base(1), T0)).wanted).toBe(true)
    c.ws.close(1000)
    await tick()
    expect((await hub.shouldBeLive(base(1), T0)).wanted).toBe(false)
  })

  it('B-24: hai viewer; đóng một vẫn live; đóng hai thì idle', async () => {
    const hub = hubFor()
    const a = await connect(hub, { userId: 1 })
    const b = await connect(hub, { userId: 2, scope: { kind: 'owner', ownerId: 1 } })
    a.ws.close(1000)
    await tick()
    expect((await hub.shouldBeLive(base(1), T0)).wanted).toBe(true)
    b.ws.close(1000)
    await tick()
    expect((await hub.shouldBeLive(base(1), T0)).wanted).toBe(false)
  })

  it('B-23: 60 giây không có hb => viewer chết, bị dọn ở lần gate kế tiếp', async () => {
    const hub = hubFor()
    const c = await connect(hub)
    expect((await hub.shouldBeLive(base(1), T0 + 59_000)).wanted).toBe(true)
    expect((await hub.shouldBeLive(base(1), T0 + 61_000)).wanted).toBe(false)
    await until(() => c.ws.readyState !== 1 || true)
    expect((await hub.stats(T0 + 61_000)).viewers).toBe(0)
  })

  it('B-25: phiên hết hạn khi kết nối còn => kick session_expired', async () => {
    const hub = hubFor()
    const c = await connect(hub, { exp: T0 + 1000 })
    expect((await hub.shouldBeLive(base(1), T0 + 2000)).wanted).toBe(false)
    await until(() => c.msgs.some((m) => m.t === 'kick'))
    expect(c.msgs.find((m) => m.t === 'kick')).toEqual({ t: 'kick', reason: 'session_expired' })
  })

  it('B-21: kết nối thứ 4 của cùng một người dùng bị kick too_many_tabs', async () => {
    const hub = hubFor()
    const now = Date.now()
    for (let i = 0; i < 3; i++) await connect(hub, { nowMs: now })
    const fourth = await connect(hub, { nowMs: now })
    await until(() => fourth.msgs.some((m) => m.t === 'kick'))
    expect(fourth.msgs[0]).toEqual({ t: 'kick', reason: 'too_many_tabs' })
    expect((await hub.stats(now)).viewers).toBe(3)
  })

  it('người dùng khác không bị tính chung giới hạn tab', async () => {
    const hub = hubFor()
    const now = Date.now()
    for (let i = 0; i < 3; i++) await connect(hub, { userId: 1, nowMs: now })
    const other = await connect(hub, { userId: 2, nowMs: now })
    await tick()
    expect(other.msgs.some((m) => m.t === 'kick')).toBe(false)
  })

  it('kickUser đá mọi kết nối của người dùng (đăng xuất)', async () => {
    const hub = hubFor()
    const c = await connect(hub, { userId: 5 })
    expect(await hub.kickUser(5, 'session_expired')).toBe(1)
    await until(() => c.msgs.some((m) => m.t === 'kick'))
  })
})

describe('LiveHub: publish và snapshot (B-12, B-20, B-27)', () => {
  it('phát mẫu tới viewer đã hello; lần đầu báo live_state live', async () => {
    const hub = hubFor()
    const c = await connect(hub, { nowMs: T0 })
    hello(c)
    await until(() => c.msgs.some((m) => m.t === 'snapshot'))
    const r = await pub(hub, 1, 1, T0, 100)
    expect(r.wanted).toBe(true)
    await until(() => c.msgs.some((m) => m.t === 'samples'))
    expect(c.msgs.some((m) => m.t === 'live_state' && m.state === 'live')).toBe(true)
  })

  it('không có viewer => wanted=false và không giữ trạng thái', async () => {
    const hub = hubFor()
    const r = await pub(hub, 1, 1, T0, 100)
    expect(r.wanted).toBe(false)
    expect((await hub.stats(T0)).linksTracked).toBe(0)
  })

  it('B-12: mẫu có t <= lastT bị bỏ, không phát lại', async () => {
    const hub = hubFor()
    const c = await connect(hub, { nowMs: T0 })
    hello(c)
    await pub(hub, 1, 1, T0, 100)
    await pub(hub, 1, 2, T0 + 3000, 100)
    await pub(hub, 1, 3, T0 + 6000, 101)
    await until(() => c.msgs.filter((m) => m.t === 'samples').length >= 2)
    await tick()
    expect(c.msgs.filter((m) => m.t === 'samples')).toHaveLength(2)
  })

  it('B-13 (hub): hai ingest cách nhau dưới 2 giây => rateLimited', async () => {
    const hub = hubFor()
    await connect(hub, { nowMs: T0 })
    await pub(hub, 1, 1, T0, 100)
    const r = await pub(hub, 1, 2, T0 + 1000, 101)
    expect(r).toMatchObject({ rateLimited: true, retryAfterSec: 2 })
  })

  it('B-11 (hub): trùng sid/seq => duplicate, không phát', async () => {
    const hub = hubFor()
    const c = await connect(hub, { nowMs: T0 })
    hello(c)
    await pub(hub, 1, 5, T0, 100)
    const r = await pub(hub, 1, 5, T0 + 3000, 200)
    expect(r.duplicate).toBe(true)
    await tick()
    expect(c.msgs.filter((m) => m.t === 'samples')).toHaveLength(1)
  })

  it('barDue: không ghi ở lần đầu, chỉ khi vừa qua ranh giới M5', async () => {
    const hub = hubFor()
    const slot = Math.floor(T0 / 300_000) * 300_000
    const t = (ms: number) => Math.floor(ms / 1000)
    // Viewer kết nối ở slot+280s để các lần publish (tua giờ) vẫn trong 60 giây có tin.
    await connect(hub, { nowMs: slot + 280_000 })
    const a = await pub(hub, 1, 1, slot + 285_000, t(slot + 285_000))
    const b = await pub(hub, 1, 2, slot + 290_000, t(slot + 290_000))
    const c = await pub(hub, 1, 3, slot + 301_000, t(slot + 301_000))
    expect([a.barDue, b.barDue, c.barDue]).toEqual([false, false, true])
  })

  it('posChanged theo pos_hash', async () => {
    const hub = hubFor()
    await connect(hub, { nowMs: T0 })
    const p = (seq: number, nowMs: number, posHash: string) =>
      hub.publish({
        ref: base(1),
        sid: 's',
        seq,
        samples: [],
        positions: [],
        posHash,
        nowMs,
      })
    expect((await p(1, T0, 'a')).posChanged).toBe(true)
    expect((await p(2, T0 + 3000, 'a')).posChanged).toBe(false)
    expect((await p(3, T0 + 6000, 'b')).posChanged).toBe(true)
  })

  it('B-20: snapshot chỉ gồm liên kết của chính người xem', async () => {
    const hub = hubFor()
    await connect(hub, { userId: 1, nowMs: T0 })
    await connect(hub, { userId: 2, nowMs: T0 })
    await pub(hub, 101, 1, T0, 100, 1)
    await pub(hub, 102, 1, T0, 100, 2)
    const a2 = await connect(hub, { userId: 1, nowMs: T0 })
    hello(a2)
    await until(() => a2.msgs.some((m) => m.t === 'snapshot'))
    const snap = a2.msgs.find((m) => m.t === 'snapshot')
    expect(snap?.t === 'snapshot' && snap.links.map((l) => l.id)).toEqual([101])
  })

  it('hello không khớp phạm vi đã cấp => đóng kết nối (không leo quyền)', async () => {
    const hub = hubFor()
    const c = await connect(hub, { scope: { kind: 'link', linkId: 7 } })
    c.ws.send(JSON.stringify({ t: 'hello', scope: 'link', id: 8 }))
    await until(() => c.ws.readyState === WebSocket.CLOSING || c.ws.readyState === WebSocket.CLOSED)
  })

  it('B-27: số viewer lấy từ attachment của kết nối (không phụ thuộc biến bộ nhớ)', async () => {
    const hub = hubFor()
    const now = Date.now()
    await connect(hub, { nowMs: now })
    await connect(hub, { nowMs: now, userId: 2 })
    expect((await hub.stats(now)).viewers).toBe(2)
  })
})

describe('scopeMatches (B-26)', () => {
  it('admin xem rộng; user chỉ xem liên kết của mình; link xem đúng một liên kết', () => {
    expect(scopeMatches({ kind: 'all' }, base(1, 9))).toBe(true)
    expect(scopeMatches({ kind: 'owner', ownerId: 2 }, base(1, 2))).toBe(true)
    expect(scopeMatches({ kind: 'owner', ownerId: 2 }, base(1, 3))).toBe(false)
    expect(scopeMatches({ kind: 'owner', ownerId: 2 }, base(1, null))).toBe(false)
    expect(scopeMatches({ kind: 'link', linkId: 4 }, base(4, 99))).toBe(true)
    expect(scopeMatches({ kind: 'link', linkId: 4 }, base(5, 99))).toBe(false)
  })
})

describe('GET /api/live/ws (B-19, B-26)', () => {
  const viewerAuth = (c: { req: { header: (n: string) => string | undefined } }): Viewer | null => {
    const raw = c.req.header('X-Test-User')
    if (!raw) return null
    const [id, role] = raw.split(':')
    return { userId: Number(id), role: (role ?? 'user') as UserRole, expiresAt: null }
  }
  const app = createApp({ viewerAuth })
  const ws = (query: string, headers: Record<string, string> = {}) =>
    app.fetch(
      new Request(`http://az.test/api/live/ws?${query}`, {
        headers: { Upgrade: 'websocket', ...headers },
      }),
      bindings,
    )

  it('B-19: không có phiên => 401; Origin sai => 403', async () => {
    expect((await ws('scope=links')).status).toBe(401)
    const bad = await ws('scope=links', { 'X-Test-User': '1:user', Origin: 'https://evil.example' })
    expect(bad.status).toBe(403)
  })

  it('từ chối request không phải WebSocket và phạm vi không hợp lệ', async () => {
    const plain = await app.fetch(new Request('http://az.test/api/live/ws?scope=links'), bindings)
    expect(plain.status).toBe(400)
    expect((await ws('scope=all', { 'X-Test-User': '1:user' })).status).toBe(400)
    expect((await ws('scope=link', { 'X-Test-User': '1:user' })).status).toBe(400)
  })

  it('B-26: user thường không mở được liên kết của người khác (404), admin mở được', async () => {
    const { id } = await seedLink()
    await setOwner(id, 10)
    expect((await ws(`scope=link&id=${id}`, { 'X-Test-User': '11:user' })).status).toBe(404)
    expect((await ws('scope=link&id=999999', { 'X-Test-User': '11:user' })).status).toBe(404)
    const mine = await ws(`scope=link&id=${id}`, { 'X-Test-User': '10:user' })
    expect(mine.status).toBe(101)
    if (mine.webSocket) wrap(mine.webSocket)
    const admin = await ws(`scope=link&id=${id}`, { 'X-Test-User': '1:root_admin' })
    expect(admin.status).toBe(101)
    if (admin.webSocket) wrap(admin.webSocket)
  })

  it('mở /links bằng route thật => gate báo live; đóng => idle', async () => {
    const { key, id } = await seedLink()
    await setOwner(id, 42)
    const res = await ws('scope=links', { 'X-Test-User': '42:user' })
    expect(res.status).toBe(101)
    const c = res.webSocket ? wrap(res.webSocket) : null
    const gate = async () =>
      (
        (await (
          await app.fetch(
            new Request('http://az.test/api/ea/v1/gate', { headers: { 'X-API-Key': key } }),
            bindings,
          )
        ).json()) as { mode: string }
      ).mode
    expect(await gate()).toBe('live')
    c?.ws.close(1000)
    await tick()
    expect(await gate()).toBe('idle')
  })
})
