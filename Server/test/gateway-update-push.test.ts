import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type GatewayOffer,
  type GwServerMessage,
  gatewayAssetUrl,
  gwServerMessageSchema,
} from '@az-sentinel/shared'
import { describe, expect, it } from 'vitest'
import { LiveHub } from '../../BE/src/live/live-hub'
import type { Bindings, HostHooks } from '../../BE/src/types'
import { runMigrations } from '../src/migrate'
import { ShimState, ShimWebSocket } from '../src/shim/cloudflare-workers'
import { openDatabase } from '../src/shim/d1'

const migrations = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../BE/migrations')
const offerOf = (version: string): GatewayOffer => ({
  version,
  url: gatewayAssetUrl(version),
  sha256: 'c'.repeat(64),
})

/** Hub thật trên shim Node; `getOffer` giả lập `HOST.gatewayOffer` của Server (undefined = như Worker, không có HOST). */
function boot(getOffer?: () => GatewayOffer | null) {
  const db = openDatabase(':memory:')
  runMigrations(db, migrations)
  const state = new ShimState()
  const host = getOffer
    ? ({ role: 'vps', gatewayOffer: getOffer } as unknown as HostHooks)
    : undefined
  const env = { DB: db as unknown as D1Database, HOST: host } as unknown as Bindings
  const hub = new LiveHub(state as unknown as DurableObjectState, env)
  state.attach(hub as never)
  return { state, hub }
}

/** Một kết nối Gateway đã qua bước nâng cấp (có attachment như `fetch` của hub tạo), chưa gửi `hello`. */
function connect(state: ShimState, connId: string): ShimWebSocket {
  const ws = new ShimWebSocket()
  state.acceptWebSocket(ws, ['gw'])
  ws.serializeAttachment({
    connId,
    openedAt: Date.now(),
    lastBeatAt: Date.now(),
    hello: false,
    vps: null,
    tokenId: 1,
    tokenOwnerId: 1,
  })
  return ws
}

const hello = (ver: string) => JSON.stringify({ t: 'hello', v: 1, gw_ver: ver, vps: 'VPS-01' })
const sent = (ws: ShimWebSocket): GwServerMessage[] =>
  (ws as unknown as { queue: Array<{ k: string; d: string }> }).queue
    .filter((q) => q.k === 'send')
    .map((q) => gwServerMessageSchema.parse(JSON.parse(q.d)))
const updates = (ws: ShimWebSocket) =>
  sent(ws).filter((m): m is Extract<GwServerMessage, { t: 'update' }> => m.t === 'update')

describe('Server ép Gateway đồng bộ bản mới', () => {
  it('Gateway cũ hơn bản Server đang giữ: nhận `update` ngay sau hello', async () => {
    const { state, hub } = boot(() => offerOf('0.4.0'))
    const ws = connect(state, 'a')
    await hub.webSocketMessage(ws, hello('0.3.7'))
    expect(updates(ws)).toEqual([
      { t: 'update', min_ver: '0.4.0', url: gatewayAssetUrl('0.4.0'), sha256: 'c'.repeat(64) },
    ])
  })

  it('Gateway đã bằng hoặc mới hơn, hoặc báo phiên bản không phải số: không bị ép', async () => {
    const { state, hub } = boot(() => offerOf('0.4.0'))
    for (const [id, ver] of [
      ['same', '0.4.0'],
      ['newer', '0.5.1'],
      ['dev', 'dev'],
      ['beta', '0.4.0-beta'],
    ] as const) {
      const ws = connect(state, id)
      await hub.webSocketMessage(ws, hello(ver))
      expect(updates(ws), id).toHaveLength(0)
    }
  })

  it('chưa có bản nào (Server chưa hỏi xong GitHub) hoặc Worker không có HOST: không ép', async () => {
    for (const b of [boot(() => null), boot(undefined)]) {
      const ws = connect(b.state, 'x')
      await b.hub.webSocketMessage(ws, hello('0.1.0'))
      expect(updates(ws)).toHaveLength(0)
      expect(await b.hub.pushGatewayUpdate()).toBe(0)
    }
  })

  it('bản mới xuất hiện sau khi Gateway đã nối: pushGatewayUpdate ép đúng Gateway cũ hơn', async () => {
    let offer: GatewayOffer | null = null
    const { state, hub } = boot(() => offer)
    const old = connect(state, 'old')
    const fresh = connect(state, 'fresh')
    const silent = connect(state, 'silent') // chưa hello: chưa biết phiên bản
    await hub.webSocketMessage(old, hello('0.3.7'))
    await hub.webSocketMessage(fresh, hello('0.4.0'))
    expect(updates(old)).toHaveLength(0)

    offer = offerOf('0.4.0')
    expect(await hub.pushGatewayUpdate()).toBe(1)
    expect(updates(old)).toHaveLength(1)
    expect(updates(fresh)).toHaveLength(0)
    expect(updates(silent)).toHaveLength(0)
  })

  it('tin update đúng schema của giao thức (Gateway parse được)', async () => {
    const { state, hub } = boot(() => offerOf('1.0.0'))
    const ws = connect(state, 'a')
    await hub.webSocketMessage(ws, hello('0.9.9'))
    const [msg] = updates(ws)
    expect(gwServerMessageSchema.safeParse(msg).success).toBe(true)
  })
})
