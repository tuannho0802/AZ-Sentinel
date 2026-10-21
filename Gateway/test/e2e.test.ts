import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { type GwClientMessage, type GwServerMessage, terminalId } from '@az-sentinel/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocketServer, type WebSocket as WsSocket } from 'ws'
import { CloudClient } from '../src/cloud'
import { Gateway } from '../src/gateway'
import { LocalServer } from '../src/local-server'
import { eventReq, ping, samplesReq } from './helpers'

/** Cloud giả: WebSocket server thật, ghi tin nhận được, trả "pong" cho "ping" như hub thật. */
async function startCloud() {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await new Promise((r) => wss.once('listening', r))
  const received: GwClientMessage[] = []
  const pings: string[] = []
  const sockets = new Set<WsSocket>()
  wss.on('connection', (s) => {
    sockets.add(s)
    s.on('close', () => sockets.delete(s))
    s.on('message', (d) => {
      const text = d.toString()
      if (text === 'ping') {
        pings.push(text)
        s.send('pong')
        return
      }
      received.push(JSON.parse(text) as GwClientMessage)
    })
  })
  return {
    url: `ws://127.0.0.1:${(wss.address() as AddressInfo).port}/api/gw/ws`,
    received,
    pings,
    push: (m: GwServerMessage) => {
      for (const s of sockets) s.send(JSON.stringify(m))
    },
    dropAll: () => {
      for (const s of sockets) s.terminate()
    },
    connections: () => sockets.size,
    of: <T extends GwClientMessage['t']>(t: T) =>
      received.filter((m): m is Extract<GwClientMessage, { t: T }> => m.t === t),
    close: () => new Promise<void>((r) => wss.close(() => r())),
  }
}

const until = async (cond: () => boolean, ms = 3000) => {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('hết thời gian chờ điều kiện')
    await new Promise((r) => setTimeout(r, 15))
  }
}

async function post(base: string, path: string, body: unknown) {
  const res = await fetch(base + path, { method: 'POST', body: JSON.stringify(body) })
  return { status: res.status, json: (await res.json()) as Record<string, unknown> }
}

let cloud: Awaited<ReturnType<typeof startCloud>>
let gw: Gateway
let local: LocalServer
let client: CloudClient
let base: string

beforeEach(async () => {
  cloud = await startCloud()
  gw = new Gateway({ cloudConfigured: true })
  gw.start()
  local = new LocalServer(gw, 0)
  await local.start()
  base = `http://127.0.0.1:${local.listeningPort}`
  client = new CloudClient(gw, { url: cloud.url, random: () => 0, pingMs: 100, silentMs: 1000 })
})

afterEach(async () => {
  client.stop()
  gw.stop()
  await local.stop()
  await cloud.close()
})

describe('API loopback', () => {
  it('ping hợp lệ: 200, JSON gọn một dòng, không khoảng trắng', async () => {
    const res = await fetch(`${base}/v1/ping`, { method: 'POST', body: JSON.stringify(ping()) })
    const text = await res.text()
    expect(res.status).toBe(200)
    expect(text).toBe(
      '{"ok":true,"bind":"pending","code":0,"watch":false,"interval_ms":2000,"lease_ms":15000}',
    )
  })

  it.each([
    ['JSON hỏng', 'POST', '/v1/ping', '{x', 400, 'invalid_json'],
    ['thiếu trường', 'POST', '/v1/ping', JSON.stringify({ v: 1 }), 400, 'invalid_body:sid'],
    ['đường dẫn lạ', 'POST', '/v1/nope', '{}', 404, 'not_found'],
    ['sai phương thức', 'GET', '/v1/ping', undefined, 405, 'method_not_allowed'],
  ])('%s', async (_n, method, path, body, status, error) => {
    const res = await fetch(base + path, { method, body })
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual({ ok: false, error })
  })

  it('body quá 128 KB: 413', async () => {
    const res = await fetch(`${base}/v1/ping`, { method: 'POST', body: 'x'.repeat(200 * 1024) })
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ ok: false, error: 'too_large' })
  })

  it('Host không phải loopback bị từ chối (chống DNS rebinding)', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: local.listeningPort,
          path: '/v1/status',
          headers: { host: 'evil.example:80' },
        },
        (r) => resolve(r.statusCode ?? 0),
      )
      req.on('error', reject)
      req.end()
    })
    expect(status).toBe(403)
  })

  it('chỉ nghe 127.0.0.1', () => {
    expect((local as unknown as { server: http.Server }).server.address()).toMatchObject({
      address: '127.0.0.1',
    })
  })

  it('/ trả HTML, /v1/status không chứa khóa', async () => {
    await post(base, '/v1/ping', ping())
    const html = await (await fetch(`${base}/`)).text()
    expect(html).toContain('<title>AZ Gateway</title>')
    const status = await (await fetch(`${base}/v1/status`)).text()
    expect(status).toContain('"login":111')
    expect(status).not.toContain('test-key')
  })

  it('cổng bị chiếm: báo lỗi rõ ràng', async () => {
    const other = new LocalServer(gw, local.listeningPort)
    await expect(other.start()).rejects.toThrow(/đang bị chiếm/)
  })
})

describe('E-22 và E-23 luồng live đầy đủ', () => {
  const tid = terminalId(111, 'Demo-1')

  it('ping -> bind -> bound -> watch -> samples -> batch -> watch rỗng', async () => {
    client.start()
    await until(() => cloud.of('hello').length === 1)

    await post(base, '/v1/ping', ping())
    await until(() => cloud.of('bind').length === 1)
    expect(cloud.of('bind')[0]).toMatchObject({ tid, key: 'test-key-0123456789', mode: 'demo' })

    cloud.push({ t: 'bound', tid, link_id: 7 })
    await until(() => cloud.of('state').length === 1)
    expect(cloud.of('state')[0]).toMatchObject({ tid, online: true })

    // Chưa ai xem: EA nhận watch:false.
    expect((await post(base, '/v1/ping', ping())).json.watch).toBe(false)

    cloud.push({ t: 'watch', tids: [tid], push_sec: 1 })
    await until(() => gw.status().watched === 1)
    const r = await post(base, '/v1/ping', ping())
    expect(r.json).toMatchObject({ bind: 'ok', watch: true, interval_ms: 1000 })

    await post(base, '/v1/samples', samplesReq({ seq: 1 }))
    await until(() => cloud.of('batch').length === 1, 3000)
    expect(cloud.of('batch')[0]?.items[0]).toMatchObject({ tid })

    // Viewer rời: watch rỗng, EA về TRACK ở ping kế tiếp, không còn batch mới.
    cloud.push({ t: 'watch', tids: [], push_sec: 1 })
    await until(() => gw.status().watched === 0)
    expect((await post(base, '/v1/ping', ping())).json.watch).toBe(false)
    await post(base, '/v1/samples', samplesReq({ seq: 2 }))
    await new Promise((r) => setTimeout(r, 1300))
    expect(cloud.of('batch')).toHaveLength(1)
  })

  it('sự kiện lệnh đi cloud ngay và rời hàng đợi khi ack', async () => {
    client.start()
    await post(base, '/v1/ping', ping())
    await until(() => cloud.of('bind').length === 1)
    cloud.push({ t: 'bound', tid, link_id: 7 })
    await until(() => gw.status().terminals[0]?.bind === 'ok')

    const r = await post(base, '/v1/event', eventReq({ seq: 1 }))
    expect(r.json).toEqual({ ok: true, ack_seq: 1 })
    await until(() => cloud.of('event').length === 1)
    const ev = cloud.of('event')[0]
    expect(ev?.events[0]).toMatchObject({ kind: 'close', position_id: 7 })
    expect(gw.status().queued).toBe(1)
    cloud.push({ t: 'ack', tid, seq: ev?.seq ?? -1 })
    await until(() => gw.status().queued === 0)
  })
})

describe('E-25 cloud khởi động lại', () => {
  const tid = terminalId(111, 'Demo-1')

  it('mất kết nối: ngừng live ngay, nối lại, bind lại, hub gửi watch lại thì live tiếp', async () => {
    client.start()
    await post(base, '/v1/ping', ping())
    await until(() => cloud.of('bind').length === 1)
    cloud.push({ t: 'bound', tid, link_id: 7 })
    cloud.push({ t: 'watch', tids: [tid], push_sec: 1 })
    await until(() => gw.status().watched === 1)

    cloud.dropAll()
    await until(() => !gw.status().cloud.connected)
    expect((await post(base, '/v1/ping', ping())).json.watch).toBe(false)

    // backoff 1s * 0.5 (random=0) => nối lại sau khoảng 500ms
    await until(() => cloud.of('bind').length === 2, 4000)
    expect(cloud.of('hello')).toHaveLength(2)
    cloud.push({ t: 'bound', tid, link_id: 7 })
    cloud.push({ t: 'watch', tids: [tid], push_sec: 1 })
    await until(() => gw.status().watched === 1)
    expect((await post(base, '/v1/ping', ping())).json.watch).toBe(true)
  })

  it('cloud im lặng quá hạn (không cả pong): Gateway tự nối lại', async () => {
    // Cloud giả không trả pong -> mô phỏng bằng cách đổi silentMs rất nhỏ trước khi có tin nào.
    client.stop()
    client = new CloudClient(gw, { url: cloud.url, random: () => 0, pingMs: 50, silentMs: 1 })
    client.start()
    await until(() => cloud.of('hello').length >= 2, 4000)
  })
})

describe('giữ nhịp WebSocket', () => {
  it('gửi "ping" văn bản đều đặn và nhận "pong" mà không coi là tin lỗi', async () => {
    client.start()
    await until(() => cloud.pings.length >= 2, 2000)
    expect(gw.status().cloud.connected).toBe(true)
  })
})

describe('E-21 không viewer', () => {
  it('3 terminal ping 1.5 giây: cloud chỉ nhận hello, bind, state; không batch/event', async () => {
    client.start()
    await until(() => cloud.of('hello').length === 1)
    for (const login of [1, 2, 3]) {
      await post(base, '/v1/ping', ping({ login }))
    }
    await until(() => cloud.of('bind').length === 3)
    for (const login of [1, 2, 3]) {
      cloud.push({ t: 'bound', tid: terminalId(login, 'Demo-1'), link_id: login })
    }
    await new Promise((r) => setTimeout(r, 1500))
    expect(cloud.of('batch')).toHaveLength(0)
    expect(cloud.of('event')).toHaveLength(0)
  })
})
