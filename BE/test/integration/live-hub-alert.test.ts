import { env } from 'cloudflare:workers'
import { type GwServerMessage, gwServerMessageSchema, terminalId } from '@az-sentinel/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { encodeGwToken, GW_HEADER, GW_TOKEN_HEADER } from '../../src/live/gw-header'
import { saveAlertSettings } from '../../src/services/alert-service'
import type { Bindings } from '../../src/types'
import { count, LOGIN, resetDb, SERVER, seedLink, setOwner } from '../helpers'

const bindings = env as unknown as Bindings
let hubSeq = 0
const hubFor = () => bindings.LIVE_HUB.getByName(`alert-${Date.now()}-${++hubSeq}`)
type Hub = ReturnType<typeof hubFor>

const OWNER = 42
const OTHER = 77
const TID = terminalId(LOGIN, SERVER)
const open: WebSocket[] = []
type Peer = { ws: WebSocket; msgs: GwServerMessage[] }

async function connectGateway(hub: Hub, tokenOwner = OWNER): Promise<Peer> {
  const res = await hub.fetch(
    new Request('http://hub/', {
      headers: {
        Upgrade: 'websocket',
        [GW_HEADER]: '1',
        [GW_TOKEN_HEADER]: encodeGwToken(1, tokenOwner),
      },
    }),
  )
  if (!res.webSocket) throw new Error(`Gateway không nâng cấp được: ${res.status}`)
  const msgs: GwServerMessage[] = []
  res.webSocket.accept()
  res.webSocket.addEventListener('message', (e) => {
    const text = String(e.data)
    if (text !== 'pong') msgs.push(JSON.parse(text) as GwServerMessage)
  })
  open.push(res.webSocket)
  return { ws: res.webSocket, msgs }
}

const until = async (fn: () => boolean, ms = 1500) => {
  const end = Date.now() + ms
  while (!fn()) {
    if (Date.now() > end) throw new Error('quá thời gian chờ')
    await new Promise((r) => setTimeout(r, 10))
  }
}
const tick = () => new Promise((r) => setTimeout(r, 60))
const cfgs = (g: Peer) =>
  g.msgs.filter((m): m is Extract<GwServerMessage, { t: 'alert_cfg' }> => m.t === 'alert_cfg')
const acks = (g: Peer) =>
  g.msgs.filter((m): m is Extract<GwServerMessage, { t: 'alert_ack' }> => m.t === 'alert_ack')

const nowSec = () => Math.floor(Date.now() / 1000)
const alertMsg = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    t: 'alert',
    tid: TID,
    aseq: nowSec(),
    kind: 'breach',
    ts: nowSec(),
    bal: 10_000,
    eq: 9_000,
    fl: -1_000,
    n: 2,
    ccy: 'USC',
    ...over,
  })

let key = ''
let linkId = 0

beforeEach(async () => {
  await resetDb()
  const seeded = await seedLink()
  key = seeded.key
  linkId = seeded.id
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

async function boundGateway(hub: Hub): Promise<Peer> {
  const g = await connectGateway(hub)
  g.ws.send(JSON.stringify({ t: 'hello', v: 1, gw_ver: '0.1.0' }))
  g.ws.send(
    JSON.stringify({ t: 'bind', tid: TID, key, login: LOGIN, server: SERVER, mode: 'demo' }),
  )
  await until(() => g.msgs.some((m) => m.t === 'bound'))
  return g
}

describe('alert_cfg', () => {
  it('hello nhận ngưỡng của chủ token (0 khi chưa đặt) và đúng schema Gateway', async () => {
    const hub = hubFor()
    const g = await connectGateway(hub)
    g.ws.send(JSON.stringify({ t: 'hello', v: 1, gw_ver: '0.1.0' }))
    await until(() => cfgs(g).length === 1)
    expect(cfgs(g)[0]?.loss_bp).toBe(0)
    for (const m of g.msgs) expect(gwServerMessageSchema.safeParse(m).success).toBe(true)

    await saveAlertSettings(env.DB, OWNER, 500, 'balance', 1)
    const g2 = await connectGateway(hub)
    g2.ws.send(JSON.stringify({ t: 'hello', v: 1, gw_ver: '0.1.0' }))
    await until(() => cfgs(g2).length === 1)
    expect(cfgs(g2)[0]?.loss_bp).toBe(500)
  })

  it('setAlertCfg chỉ đẩy xuống Gateway của đúng chủ', async () => {
    const hub = hubFor()
    const mine = await connectGateway(hub, OWNER)
    const theirs = await connectGateway(hub, OTHER)
    for (const g of [mine, theirs]) g.ws.send(JSON.stringify({ t: 'hello', v: 1, gw_ver: '0.1.0' }))
    await until(() => cfgs(mine).length === 1 && cfgs(theirs).length === 1)

    expect(await hub.setAlertCfg(OWNER, 750)).toBe(1)
    await until(() => cfgs(mine).length === 2)
    expect(cfgs(mine)[1]?.loss_bp).toBe(750)
    await tick()
    expect(cfgs(theirs)).toHaveLength(1)
  })
})

describe('alert từ Gateway', () => {
  it('terminal đã bind: tạo thông báo cho chủ, trả alert_ack; gửi lại không tạo thêm', async () => {
    await saveAlertSettings(env.DB, OWNER, 500, 'balance', 1)
    const hub = hubFor()
    const g = await boundGateway(hub)
    const aseq = nowSec()
    g.ws.send(alertMsg({ aseq }))
    await until(() => acks(g).length === 1)
    expect(acks(g)[0]).toMatchObject({ tid: TID, aseq })
    expect(await count('notifications', `owner_id = ${OWNER}`)).toBe(1)

    g.ws.send(alertMsg({ aseq })) // Gateway gửi lại vì chưa thấy ack
    await until(() => acks(g).length === 2)
    expect(await count('notifications')).toBe(1)
  })

  it('báo cáo không đủ để báo (ngưỡng tắt) vẫn được ack để Gateway ngừng gửi lại', async () => {
    const hub = hubFor()
    const g = await boundGateway(hub)
    g.ws.send(alertMsg())
    await until(() => acks(g).length === 1)
    expect(await count('notifications')).toBe(0)
  })

  it('terminal chưa bind: không ack, không tạo thông báo', async () => {
    await saveAlertSettings(env.DB, OWNER, 500, 'balance', 1)
    const hub = hubFor()
    const g = await connectGateway(hub)
    g.ws.send(JSON.stringify({ t: 'hello', v: 1, gw_ver: '0.1.0' }))
    g.ws.send(alertMsg())
    await tick()
    expect(acks(g)).toHaveLength(0)
    expect(await count('notifications')).toBe(0)
  })
})
