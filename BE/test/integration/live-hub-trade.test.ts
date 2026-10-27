import { env } from 'cloudflare:workers'
import {
  type GwServerMessage,
  gwServerMessageSchema,
  type ServerMessage,
  terminalId,
} from '@az-sentinel/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { encodeGwToken, GW_HEADER, GW_TOKEN_HEADER } from '../../src/live/gw-header'
import { encodeViewer, VIEWER_HEADER } from '../../src/live/viewer-header'
import type { Bindings } from '../../src/types'
import { LOGIN, resetDb, SERVER, seedLink, setOwner } from '../helpers'

const bindings = env as unknown as Bindings
let hubSeq = 0
const hubFor = () => bindings.LIVE_HUB.getByName(`trade-${Date.now()}-${++hubSeq}`)
type Hub = ReturnType<typeof hubFor>

const OWNER = 42
const TID = terminalId(LOGIN, SERVER)
const CMD = '0123456789abcdef'
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

async function connectViewer(hub: Hub, linkId: number, userId = OWNER) {
  const viewer = encodeViewer({
    userId,
    role: 'user',
    scope: { kind: 'link', linkId },
    expiresAt: null,
    nowMs: Date.now(),
  })
  const res = await hub.fetch(
    new Request('http://hub/', { headers: { Upgrade: 'websocket', [VIEWER_HEADER]: viewer } }),
  )
  if (!res.webSocket) throw new Error(`viewer không nâng cấp được: ${res.status}`)
  const peer = accept<ServerMessage>(res.webSocket)
  peer.ws.send(JSON.stringify({ t: 'hello', scope: 'link', id: linkId }))
  return peer
}

const until = async (fn: () => boolean, ms = 1500) => {
  const end = Date.now() + ms
  while (!fn()) {
    if (Date.now() > end) throw new Error('quá thời gian chờ')
    await new Promise((r) => setTimeout(r, 10))
  }
}
const tick = () => new Promise((r) => setTimeout(r, 40))
const snap = { bal: 10000, eq: 10010, fl: 10, ml: null }

/** Gateway giả đã bind và báo terminal online. */
async function onlineGateway(hub: Hub, key: string, online = true) {
  const g = await connectGateway(hub)
  g.ws.send(JSON.stringify({ t: 'hello', v: 1, gw_ver: '0.3.4' }))
  g.ws.send(
    JSON.stringify({ t: 'bind', tid: TID, key, login: LOGIN, server: SERVER, mode: 'demo' }),
  )
  await until(() => g.msgs.some((m) => m.t === 'bound'))
  if (online) {
    g.ws.send(JSON.stringify({ t: 'state', tid: TID, online: true, snap }))
    await tick()
  }
  return g
}

const tradeMsgs = (g: Peer<GwServerMessage>) =>
  g.msgs.filter((m): m is Extract<GwServerMessage, { t: 'trade' }> => m.t === 'trade')

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

describe('sendTrade: hub chuyển lệnh cho Gateway', () => {
  it('close, partial_close, modify đều tới Gateway đúng dạng và hợp schema', async () => {
    const hub = hubFor()
    const g = await onlineGateway(hub, key)
    expect(await hub.sendTrade(linkId, { cmd_id: CMD, op: 'close', ticket: 777 })).toEqual({
      sent: true,
    })
    await hub.sendTrade(linkId, {
      cmd_id: 'aaaaaaaaaaaaaaaa',
      op: 'partial_close',
      ticket: 5,
      volume: 0.02,
    })
    await hub.sendTrade(linkId, {
      cmd_id: 'bbbbbbbbbbbbbbbb',
      op: 'modify',
      ticket: 6,
      sl: 0,
      tp: 4100.5,
    })
    await until(() => tradeMsgs(g).length === 3)
    const [a, b, c] = tradeMsgs(g)
    expect(a).toMatchObject({ tid: TID, cmd_id: CMD, op: 'close', ticket: 777 })
    expect(a?.volume).toBeUndefined()
    expect(b).toMatchObject({ op: 'partial_close', ticket: 5, volume: 0.02 })
    expect(c).toMatchObject({ op: 'modify', ticket: 6, sl: 0, tp: 4100.5 })
    for (const m of tradeMsgs(g)) expect(gwServerMessageSchema.safeParse(m).success).toBe(true)
  })

  it('terminal offline hoặc không có Gateway: không gửi, không xếp hàng', async () => {
    const hub = hubFor()
    expect(await hub.sendTrade(linkId, { cmd_id: CMD, op: 'close', ticket: 1 })).toEqual({
      sent: false,
      reason: 'terminal_offline',
    })
    const g = await onlineGateway(hub, key, false)
    expect(await hub.sendTrade(linkId, { cmd_id: CMD, op: 'close', ticket: 1 })).toMatchObject({
      sent: false,
    })
    await tick()
    expect(tradeMsgs(g)).toHaveLength(0)
  })

  it('không gửi sang liên kết khác', async () => {
    const hub = hubFor()
    const g = await onlineGateway(hub, key)
    expect(
      await hub.sendTrade(linkId + 999, { cmd_id: CMD, op: 'close', ticket: 1 }),
    ).toMatchObject({ sent: false })
    await tick()
    expect(tradeMsgs(g)).toHaveLength(0)
  })
})

describe('trade_result: kết quả từ Gateway', () => {
  const insertLog = () =>
    env.DB.prepare(
      `INSERT INTO trade_log (link_id, user_id, cmd_id, op, ticket, status, created_at)
       VALUES (?, 1, ?, 'close', 777, 'sent', ?)`,
    )
      .bind(linkId, CMD, Math.floor(Date.now() / 1000))
      .run()
  const logRow = () =>
    env.DB.prepare('SELECT status, reason, code, detail FROM trade_log WHERE cmd_id = ?')
      .bind(CMD)
      .first<{
        status: string
        reason: string | null
        code: number | null
        detail: string | null
      }>()
  const result = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      t: 'trade_result',
      tid: TID,
      cmd_id: CMD,
      status: 'done',
      reason: 'ok',
      code: 10009,
      detail: 'Request executed',
      ...over,
    })

  it('phát cho viewer của liên kết và ghi nhật ký', async () => {
    const hub = hubFor()
    const g = await onlineGateway(hub, key)
    const v = await connectViewer(hub, linkId)
    await insertLog()
    g.ws.send(result({ left: 0.03 }))
    await until(() => v.msgs.some((m) => m.t === 'trade_result'))
    expect(v.msgs.find((m) => m.t === 'trade_result')).toMatchObject({
      t: 'trade_result',
      id: linkId,
      cmd_id: CMD,
      status: 'done',
      code: 10009,
      left: 0.03,
    })
    await tick()
    expect(await logRow()).toMatchObject({ status: 'done', reason: 'ok', code: 10009 })
  })

  it('viewer của liên kết khác không nhận được', async () => {
    const hub = hubFor()
    const g = await onlineGateway(hub, key)
    const other = await connectViewer(hub, linkId + 1000)
    g.ws.send(result())
    await tick()
    expect(other.msgs.some((m) => m.t === 'trade_result')).toBe(false)
  })

  it('kết quả muộn ghi đè timeout, nhưng done không bị ghi đè nữa', async () => {
    const hub = hubFor()
    const g = await onlineGateway(hub, key)
    await insertLog()
    g.ws.send(result({ status: 'timeout', reason: 'no_reply', code: 0, detail: '' }))
    await tick()
    expect(await logRow()).toMatchObject({ status: 'timeout' })
    g.ws.send(result())
    await tick()
    expect(await logRow()).toMatchObject({ status: 'done' })
    g.ws.send(result({ status: 'failed', reason: 'retcode', code: 10006 }))
    await tick()
    expect(await logRow()).toMatchObject({ status: 'done', code: 10009 })
  })

  it('terminal không thuộc Gateway này thì bị bỏ qua', async () => {
    const hub = hubFor()
    const g = await onlineGateway(hub, key)
    const v = await connectViewer(hub, linkId)
    g.ws.send(result({ tid: '1@Khac-Server' }))
    await tick()
    expect(v.msgs.some((m) => m.t === 'trade_result')).toBe(false)
  })
})

describe('Pha 2: hub chuyển market, pending, close_all', () => {
  it('market tới Gateway đủ trường, không có ticket, hợp schema', async () => {
    const hub = hubFor()
    const g = await onlineGateway(hub, key)
    expect(
      await hub.sendTrade(linkId, {
        cmd_id: CMD,
        op: 'market',
        symbol: 'XAUUSD',
        side: 'sell',
        volume: 0.1,
        sl: 4100,
        tp: 0,
      }),
    ).toEqual({ sent: true })
    await until(() => tradeMsgs(g).length === 1)
    const m = tradeMsgs(g)[0]
    expect(m).toMatchObject({
      tid: TID,
      cmd_id: CMD,
      op: 'market',
      symbol: 'XAUUSD',
      side: 'sell',
      volume: 0.1,
      sl: 4100,
      tp: 0,
    })
    expect(m?.ticket).toBeUndefined()
    expect(gwServerMessageSchema.safeParse(m).success).toBe(true)
  })

  it('pending tới Gateway kèm kind và price', async () => {
    const hub = hubFor()
    const g = await onlineGateway(hub, key)
    await hub.sendTrade(linkId, {
      cmd_id: CMD,
      op: 'pending',
      symbol: 'EURUSD',
      kind: 'sell_stop',
      volume: 0.5,
      price: 1.08,
      sl: 1.09,
      tp: 1.07,
    })
    await until(() => tradeMsgs(g).length === 1)
    const m = tradeMsgs(g)[0]
    expect(m).toMatchObject({ op: 'pending', kind: 'sell_stop', price: 1.08, volume: 0.5 })
    expect(gwServerMessageSchema.safeParse(m).success).toBe(true)
  })

  it('close_all tới Gateway chỉ kèm filter', async () => {
    const hub = hubFor()
    const g = await onlineGateway(hub, key)
    await hub.sendTrade(linkId, { cmd_id: CMD, op: 'close_all', filter: 'profit' })
    await until(() => tradeMsgs(g).length === 1)
    const m = tradeMsgs(g)[0]
    expect(m).toMatchObject({ op: 'close_all', filter: 'profit' })
    expect(m?.ticket).toBeUndefined()
    expect(m?.volume).toBeUndefined()
    expect(gwServerMessageSchema.safeParse(m).success).toBe(true)
  })

  it('terminal offline: lệnh mới cũng không được gửi', async () => {
    const hub = hubFor()
    const g = await onlineGateway(hub, key, false)
    expect(
      await hub.sendTrade(linkId, { cmd_id: CMD, op: 'close_all', filter: 'all' }),
    ).toMatchObject({ sent: false })
    await tick()
    expect(tradeMsgs(g)).toHaveLength(0)
  })

  it('trade_result mang order, n_ok, n_fail tới viewer nguyên vẹn', async () => {
    const hub = hubFor()
    const g = await onlineGateway(hub, key)
    const v = await connectViewer(hub, linkId)
    const base = { t: 'trade_result', tid: TID, status: 'done', reason: 'ok', code: 10009 }
    g.ws.send(JSON.stringify({ ...base, cmd_id: CMD, detail: '', order: 123456 }))
    g.ws.send(
      JSON.stringify({
        ...base,
        cmd_id: 'cccccccccccccccc',
        status: 'failed',
        reason: 'partial',
        detail: '',
        n_ok: 3,
        n_fail: 1,
      }),
    )
    await until(() => v.msgs.filter((m) => m.t === 'trade_result').length === 2)
    const rs = v.msgs.filter((m) => m.t === 'trade_result')
    expect(rs[0]).toMatchObject({ cmd_id: CMD, order: 123456 })
    expect(rs[1]).toMatchObject({ reason: 'partial', n_ok: 3, n_fail: 1 })
  })
})
