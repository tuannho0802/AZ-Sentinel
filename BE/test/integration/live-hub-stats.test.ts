import { env } from 'cloudflare:workers'
import {
  type GwServerMessage,
  type ServerMessage,
  serverMessageSchema,
  terminalId,
} from '@az-sentinel/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { encodeGwToken, GW_HEADER, GW_TOKEN_HEADER } from '../../src/live/gw-header'
import { encodeViewer, VIEWER_HEADER } from '../../src/live/viewer-header'
import type { Bindings } from '../../src/types'
import { LOGIN, resetDb, SERVER, seedLink, setOwner } from '../helpers'

const bindings = env as unknown as Bindings
let hubSeq = 0
const hubFor = () => bindings.LIVE_HUB.getByName(`stats-${Date.now()}-${++hubSeq}`)
type Hub = ReturnType<typeof hubFor>

const OWNER = 42
const TID = terminalId(LOGIN, SERVER)
const open: WebSocket[] = []
type Peer<M> = { ws: WebSocket; msgs: M[] }

function accept<M>(ws: WebSocket): Peer<M> {
  const msgs: M[] = []
  ws.accept()
  ws.addEventListener('message', (e) => {
    const text = String(e.data)
    if (text !== 'pong') msgs.push(JSON.parse(text) as M)
  })
  open.push(ws)
  return { ws, msgs }
}

async function connectGateway(hub: Hub): Promise<Peer<GwServerMessage>> {
  const res = await hub.fetch(
    new Request('http://hub/', {
      headers: {
        Upgrade: 'websocket',
        [GW_HEADER]: '1',
        [GW_TOKEN_HEADER]: encodeGwToken(1, OWNER),
      },
    }),
  )
  if (!res.webSocket) throw new Error(`Gateway không nâng cấp được: ${res.status}`)
  return accept<GwServerMessage>(res.webSocket)
}

async function connectViewer(hub: Hub, scope: 'link' | 'links', linkId: number) {
  const viewer = encodeViewer({
    userId: OWNER,
    role: 'user',
    scope: scope === 'link' ? { kind: 'link', linkId } : { kind: 'owner', ownerId: OWNER },
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
      scope === 'link' ? { t: 'hello', scope: 'link', id: linkId } : { t: 'hello', scope: 'links' },
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
const tick = () => new Promise((r) => setTimeout(r, 60))

const period = (pl: number) => ({
  from: 1_760_000_000,
  to: 1_760_086_400,
  open: { pl, n: 2, w: 1 },
  close: { pl: pl + 1, n: 3, w: 2 },
})
const statsMsg = (pl: number) => ({
  t: 'stats',
  tid: TID,
  sts: 1_760_000_100,
  ccy: 'USD',
  periods: {
    today: period(pl),
    yesterday: period(1),
    d3: period(2),
    lastweek: period(3),
    lastmonth: period(4),
  },
})

async function boundGateway(hub: Hub, key: string) {
  const g = await connectGateway(hub)
  g.ws.send(JSON.stringify({ t: 'hello', v: 1, gw_ver: '0.3.4' }))
  g.ws.send(
    JSON.stringify({ t: 'bind', tid: TID, key, login: LOGIN, server: SERVER, mode: 'demo' }),
  )
  await until(() => g.msgs.some((m) => m.t === 'bound'))
  return g
}

const statsOf = (v: Peer<ServerMessage>) =>
  v.msgs.filter((m): m is Extract<ServerMessage, { t: 'stats' }> => m.t === 'stats')

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

describe('hub chuyển tiếp thống kê lãi/lỗ do EA tính', () => {
  it('người xem chi tiết nhận nguyên số của EA, hợp schema; người xem danh sách thì không', async () => {
    const hub = hubFor()
    const g = await boundGateway(hub, key)
    const detail = await connectViewer(hub, 'link', linkId)
    const list = await connectViewer(hub, 'links', linkId)
    await tick()

    g.ws.send(JSON.stringify(statsMsg(10)))
    await until(() => statsOf(detail).length === 1)
    const m = statsOf(detail)[0]
    expect(m?.id).toBe(linkId)
    expect(m?.periods.today.open.pl).toBe(10)
    expect(m?.periods.today.close.pl).toBe(11)
    expect(m?.ccy).toBe('USD')
    expect(serverMessageSchema.safeParse(m).success).toBe(true)
    await tick()
    expect(statsOf(list)).toHaveLength(0)
  })

  it('người vào xem chi tiết sau nhận bản mới nhất trong snapshot', async () => {
    const hub = hubFor()
    const g = await boundGateway(hub, key)
    const first = await connectViewer(hub, 'link', linkId)
    await tick()
    g.ws.send(JSON.stringify(statsMsg(10)))
    g.ws.send(JSON.stringify(statsMsg(25)))
    await until(() => statsOf(first).length === 2)

    // Mẫu live để snapshot có dòng cho liên kết này.
    g.ws.send(
      JSON.stringify({
        t: 'batch',
        items: [
          { tid: TID, samples: [{ t: Math.floor(Date.now() / 1000), eq: 1, bal: 1, fl: 0 }] },
        ],
      }),
    )
    await tick()

    const late = await connectViewer(hub, 'link', linkId)
    await until(() => late.msgs.some((m) => m.t === 'snapshot'))
    const snapshot = late.msgs.find(
      (m): m is Extract<ServerMessage, { t: 'snapshot' }> => m.t === 'snapshot',
    )
    expect(snapshot?.links.find((l) => l.id === linkId)?.stats?.periods.today.open.pl).toBe(25)
    expect(serverMessageSchema.safeParse(snapshot).success).toBe(true)
  })

  it('không ai xem chi tiết: bỏ, không báo lỗi', async () => {
    const hub = hubFor()
    const g = await boundGateway(hub, key)
    const list = await connectViewer(hub, 'links', linkId)
    await tick()
    g.ws.send(JSON.stringify(statsMsg(10)))
    await tick()
    expect(statsOf(list)).toHaveLength(0)
  })
})
