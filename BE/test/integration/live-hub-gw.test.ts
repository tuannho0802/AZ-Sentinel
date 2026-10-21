import { env } from 'cloudflare:workers'
import {
  GW,
  type GwServerMessage,
  gwServerMessageSchema,
  type ServerMessage,
  terminalId,
} from '@az-sentinel/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GW_HEADER } from '../../src/live/gw-header'
import { encodeViewer, VIEWER_HEADER } from '../../src/live/viewer-header'
import type { Bindings } from '../../src/types'
import { LOGIN, resetDb, SERVER, seedLink, setOwner } from '../helpers'

const bindings = env as unknown as Bindings
let hubSeq = 0
const hubFor = () => bindings.LIVE_HUB.getByName(`gw-${Date.now()}-${++hubSeq}`)
type Hub = ReturnType<typeof hubFor>

const OWNER = 42
const TID = terminalId(LOGIN, SERVER)
const open: WebSocket[] = []

/** Trang đang xem: danh sách `/links` hoặc đúng một liên kết `/links/:id`. */
type Where = { kind: 'links' } | { kind: 'link'; linkId: number }

type Peer<M> = { ws: WebSocket; msgs: M[] }

function accept<M>(ws: WebSocket): Peer<M> {
  const msgs: M[] = []
  ws.accept()
  ws.addEventListener('message', (e) => {
    const text = String(e.data)
    if (text === 'pong') return
    msgs.push(JSON.parse(text) as M)
  })
  open.push(ws)
  return { ws, msgs }
}

async function connectGateway(hub: Hub): Promise<Peer<GwServerMessage>> {
  const res = await hub.fetch(
    new Request('http://hub/', { headers: { Upgrade: 'websocket', [GW_HEADER]: '1' } }),
  )
  if (!res.webSocket) throw new Error(`Gateway không nâng cấp được: ${res.status}`)
  return accept<GwServerMessage>(res.webSocket)
}

async function connectViewer(hub: Hub, scope: Where): Promise<Peer<ServerMessage>> {
  const viewer = encodeViewer({
    userId: OWNER,
    role: 'user',
    scope: scope.kind === 'link' ? scope : { kind: 'owner', ownerId: OWNER },
    expiresAt: null,
    nowMs: Date.now(),
  })
  const res = await hub.fetch(
    new Request('http://hub/', { headers: { Upgrade: 'websocket', [VIEWER_HEADER]: viewer } }),
  )
  if (!res.webSocket) throw new Error(`viewer không nâng cấp được: ${res.status}`)
  const peer = accept<ServerMessage>(res.webSocket)
  peer.ws.send(
    JSON.stringify(
      scope.kind === 'link'
        ? { t: 'hello', scope: 'link', id: scope.linkId }
        : { t: 'hello', scope: 'links' },
    ),
  )
  return peer
}

const until = async (fn: () => boolean, ms = 1500) => {
  const end = Date.now() + ms
  while (!fn()) {
    if (Date.now() > end) throw new Error('quá thời gian chờ')
    await new Promise((r) => setTimeout(r, 10))
  }
}
const untilAsync = async (fn: () => Promise<boolean>, ms = 1500) => {
  const end = Date.now() + ms
  while (!(await fn())) {
    if (Date.now() > end) throw new Error('quá thời gian chờ')
    await new Promise((r) => setTimeout(r, 10))
  }
}
const tick = () => new Promise((r) => setTimeout(r, 40))

const watches = (g: Peer<GwServerMessage>) =>
  g.msgs.filter((m): m is Extract<GwServerMessage, { t: 'watch' }> => m.t === 'watch')
const lastWatch = (g: Peer<GwServerMessage>) => watches(g).at(-1)

/** Gateway giả: hello, bind khóa của liên kết đã seed, chờ `bound`. */
async function boundGateway(hub: Hub, key: string): Promise<Peer<GwServerMessage>> {
  const g = await connectGateway(hub)
  g.ws.send(JSON.stringify({ t: 'hello', v: 1, gw_ver: '0.1.0' }))
  g.ws.send(
    JSON.stringify({ t: 'bind', tid: TID, key, login: LOGIN, server: SERVER, mode: 'demo' }),
  )
  await until(() => g.msgs.some((m) => m.t === 'bound'))
  return g
}

const nowSec = () => Math.floor(Date.now() / 1000)
const sample = (eq: number, t = nowSec()) => ({ t, eq, bal: 10000, fl: eq - 10000, ml: null })
const batch = (item: Record<string, unknown>) =>
  JSON.stringify({ t: 'batch', items: [{ tid: TID, ...item }] })

let linkId = 0
let key = ''

beforeEach(async () => {
  await resetDb()
  const seeded = await seedLink()
  linkId = seeded.id
  key = seeded.key
  await setOwner(linkId, OWNER)
})
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

describe('watch.fast: xem riêng một liên kết => theo tick', () => {
  it('tin watch của hub hợp lệ theo schema Gateway', async () => {
    const hub = hubFor()
    const g = await boundGateway(hub, key)
    await connectViewer(hub, { kind: 'link', linkId })
    await until(() => (lastWatch(g)?.tids.length ?? 0) === 1)
    for (const m of g.msgs) expect(gwServerMessageSchema.safeParse(m).success).toBe(true)
  })

  it('chỉ có viewer danh sách: terminal được xem nhưng KHÔNG nằm trong fast', async () => {
    const hub = hubFor()
    const g = await boundGateway(hub, key)
    await connectViewer(hub, { kind: 'links' })
    await until(() => (lastWatch(g)?.tids.length ?? 0) === 1)
    expect(lastWatch(g)).toMatchObject({ tids: [TID], fast: [], push_sec: GW.defaultPushSec })
  })

  it('viewer chi tiết vào/ra: fast xuất hiện rồi biến mất; danh sách vẫn giữ watch', async () => {
    const hub = hubFor()
    const g = await boundGateway(hub, key)
    await connectViewer(hub, { kind: 'links' })
    await until(() => (lastWatch(g)?.tids.length ?? 0) === 1)
    const detail = await connectViewer(hub, { kind: 'link', linkId })
    await until(() => (lastWatch(g)?.fast ?? []).length === 1)
    expect(lastWatch(g)).toMatchObject({ tids: [TID], fast: [TID] })
    detail.ws.close(1000)
    await until(() => (lastWatch(g)?.fast ?? ['x']).length === 0)
    expect(lastWatch(g)).toMatchObject({ tids: [TID], fast: [] })
  })

  it('viewer xem riêng liên kết khác thì terminal này không được watch', async () => {
    const hub = hubFor()
    const g = await boundGateway(hub, key)
    await connectViewer(hub, { kind: 'link', linkId: linkId + 1000 })
    await tick()
    expect(lastWatch(g)?.tids ?? []).toEqual([])
  })
})

describe('phiên bản EA', () => {
  const eaVerInDb = async () =>
    (
      await env.DB.prepare('SELECT ea_ver FROM link_state WHERE link_id = ?')
        .bind(linkId)
        .first<{ ea_ver: string | null }>()
    )?.ea_ver ?? null
  const snap = { bal: 10000, eq: 10010, fl: 10, ml: null }

  it('ea_ver trong bind được ghi vào link_state khi state online đến', async () => {
    const hub = hubFor()
    const g = await connectGateway(hub)
    g.ws.send(JSON.stringify({ t: 'hello', v: 1, gw_ver: '0.1.0' }))
    g.ws.send(
      JSON.stringify({
        t: 'bind',
        tid: TID,
        key,
        login: LOGIN,
        server: SERVER,
        mode: 'demo',
        ea_ver: '0.3.0',
      }),
    )
    await until(() => g.msgs.some((m) => m.t === 'bound'))
    g.ws.send(JSON.stringify({ t: 'state', tid: TID, online: true, snap }))
    await untilAsync(async () => (await eaVerInDb()) === '0.3.0')
    expect(await eaVerInDb()).toBe('0.3.0')
  })

  it('EA đổi phiên bản dù vẫn online: link_state cập nhật theo bản mới', async () => {
    const hub = hubFor()
    const g = await boundGateway(hub, key)
    g.ws.send(JSON.stringify({ t: 'state', tid: TID, online: true, snap, ea_ver: '0.2.0' }))
    await untilAsync(async () => (await eaVerInDb()) === '0.2.0')
    g.ws.send(JSON.stringify({ t: 'state', tid: TID, online: true, snap, ea_ver: '0.3.0' }))
    await untilAsync(async () => (await eaVerInDb()) === '0.3.0')
    expect(await eaVerInDb()).toBe('0.3.0')
  })
})

describe('batch: phát theo tick, pl', () => {
  it('nhiều tick cùng một giây đều được phát; bản trùng hệt thì bị bỏ', async () => {
    const hub = hubFor()
    const g = await boundGateway(hub, key)
    const v = await connectViewer(hub, { kind: 'link', linkId })
    await until(() => (lastWatch(g)?.fast ?? []).length === 1)
    const t = nowSec()
    g.ws.send(batch({ samples: [sample(10100, t), sample(10101, t)] }))
    g.ws.send(batch({ samples: [sample(10101, t)] })) // trùng hệt tick trước
    g.ws.send(batch({ samples: [sample(10102, t)] }))
    await until(() => v.msgs.filter((m) => m.t === 'samples').length >= 2)
    await tick()
    const eqs = v.msgs.flatMap((m) => (m.t === 'samples' ? m.samples.map((s) => s.eq) : []))
    expect(eqs).toEqual([10100, 10101, 10102])
  })

  it('mẫu lùi về trước bị bỏ', async () => {
    const hub = hubFor()
    const g = await boundGateway(hub, key)
    const v = await connectViewer(hub, { kind: 'link', linkId })
    await until(() => (lastWatch(g)?.fast ?? []).length === 1)
    const t = nowSec()
    g.ws.send(batch({ samples: [sample(10100, t)] }))
    await until(() => v.msgs.some((m) => m.t === 'samples'))
    g.ws.send(batch({ samples: [sample(9999, t - 5)] }))
    await tick()
    expect(v.msgs.filter((m) => m.t === 'samples')).toHaveLength(1)
  })

  it('pl chỉ tới viewer xem riêng; viewer danh sách nhận samples không có pl', async () => {
    const hub = hubFor()
    const g = await boundGateway(hub, key)
    const list = await connectViewer(hub, { kind: 'links' })
    const detail = await connectViewer(hub, { kind: 'link', linkId })
    await until(() => (lastWatch(g)?.fast ?? []).length === 1)
    g.ws.send(batch({ samples: [sample(10100)], pl: { '4016996233': 4.92 } }))
    await until(() => detail.msgs.some((m) => m.t === 'samples'))
    await until(() => list.msgs.some((m) => m.t === 'samples'))
    const d = detail.msgs.find((m) => m.t === 'samples')
    const l = list.msgs.find((m) => m.t === 'samples')
    expect(d?.t === 'samples' && d.pl).toEqual({ '4016996233': 4.92 })
    expect(l?.t === 'samples' && l.pl).toBeUndefined()
  })

  it('snapshot của viewer vào sau có lãi/lỗ lệnh đã cập nhật theo pl', async () => {
    const hub = hubFor()
    const g = await boundGateway(hub, key)
    const first = await connectViewer(hub, { kind: 'link', linkId })
    await until(() => (lastWatch(g)?.fast ?? []).length === 1)
    const position = {
      ticket: 7,
      symbol: 'XAUUSDm',
      type: 'sell',
      volume: 0.01,
      time: nowSec(),
      price: 4120.8,
      profit: 1,
    }
    g.ws.send(batch({ samples: [sample(10100)], positions: [position], pos_hash: 'h1' }))
    await until(() => first.msgs.some((m) => m.t === 'positions'))
    g.ws.send(batch({ samples: [sample(10105)], pl: { '7': 5.5 } }))
    await until(() => first.msgs.filter((m) => m.t === 'samples').length >= 2)

    const late = await connectViewer(hub, { kind: 'link', linkId })
    await until(() => late.msgs.some((m) => m.t === 'snapshot'))
    const snap = late.msgs.find((m) => m.t === 'snapshot')
    const positions = snap?.t === 'snapshot' ? snap.links[0]?.positions : undefined
    expect(positions?.[0]?.profit).toBe(5.5)
  })
})
