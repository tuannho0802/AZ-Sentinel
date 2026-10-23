import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocketServer } from 'ws'
import { CloudClient } from '../src/cloud'
import { Gateway } from '../src/gateway'

/** "VPS" giả: một WebSocket server ở cổng ngẫu nhiên. `kill()` mô phỏng VPS sập (tunnel chết). */
async function startVps() {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await new Promise((r) => wss.once('listening', r))
  let connections = 0
  wss.on('connection', (s) => {
    connections++
    s.on('message', (d) => d.toString() === 'ping' && s.send('pong'))
  })
  return {
    url: `ws://127.0.0.1:${(wss.address() as AddressInfo).port}/api/gw/ws`,
    connections: () => connections,
    kill: () =>
      new Promise<void>((r) => {
        for (const s of wss.clients) s.terminate()
        wss.close(() => r())
      }),
  }
}

const until = async (cond: () => boolean, ms = 4000) => {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('hết thời gian chờ điều kiện')
    await new Promise((r) => setTimeout(r, 15))
  }
}

// WebSocket tunnel thật là wss://; test dùng ws:// nên cho phép qua bằng cách bọc trả về `wsUrl` của VPS giả.
// Danh bạ giả: trả `wsUrl` hiện tại và đếm số lần bị hỏi (= số request tốn trên Worker).
function directory(initial: string | null) {
  const state = { wsUrl: initial, asked: 0, auths: [] as (string | null)[], down: false }
  const fetchFn = (async (_url: string, init?: RequestInit) => {
    state.asked++
    state.auths.push(new Headers(init?.headers).get('Authorization'))
    if (state.down) throw new Error('worker sập')
    return Response.json({ ok: true, origin: state.wsUrl ? 'https://x' : null, wsUrl: state.wsUrl })
  }) as unknown as typeof fetch
  return { state, fetchFn }
}

const opened: { stop: () => void }[] = []
afterEach(() => {
  for (const c of opened.splice(0)) c.stop()
})

function make(opts: ConstructorParameters<typeof CloudClient>[1]) {
  const gw = new Gateway({ cloudConfigured: true, idleFlushSec: 0 })
  gw.start()
  const client = new CloudClient(gw, { random: () => 0, pingMs: 100, silentMs: 1000, ...opts })
  opened.push(client, { stop: () => gw.stop() })
  return client
}

describe('Gateway tự tìm Quick Tunnel mới qua danh bạ (Plan 3H)', () => {
  it('khởi động: hỏi danh bạ rồi nối THẲNG vào tunnel, không nối địa chỉ cấu hình', async () => {
    const tunnel = await startVps()
    const configured = await startVps()
    const dir = directory(tunnel.url)
    const c = make({
      url: configured.url,
      directoryUrls: ['http://dir/api/gw/tunnel'],
      fetchFn: dir.fetchFn,
      token: 'azt_x',
    })
    c.start()
    await until(() => tunnel.connections() === 1)
    expect(configured.connections()).toBe(0)
    expect(dir.state.auths).toEqual(['Bearer azt_x'])
    await tunnel.kill()
    await configured.kill()
  })

  it('VPS reset đổi tunnel: Gateway nối sang tunnel mới ngay, không rơi xuống dự phòng', async () => {
    const a = await startVps()
    const b = await startVps()
    const fallback = await startVps()
    const dir = directory(a.url)
    const c = make({
      url: a.url,
      fallbackUrl: fallback.url,
      directoryUrls: ['http://dir/api/gw/tunnel'],
      fetchFn: dir.fetchFn,
    })
    c.start()
    await until(() => a.connections() === 1)
    // VPS sập; tunnel mới lên và đã báo cho Worker trước khi Gateway kịp hỏi
    dir.state.wsUrl = b.url
    await a.kill()
    await until(() => b.connections() === 1)
    expect(fallback.connections()).toBe(0)
    await b.kill()
    await fallback.kill()
  })

  it('VPS chưa báo tunnel mới: dùng dự phòng, rồi tự về tunnel mới khi danh bạ có địa chỉ (không thao tác)', async () => {
    const a = await startVps()
    const b = await startVps()
    const fallback = await startVps()
    const dir = directory(a.url)
    const c = make({
      url: a.url,
      fallbackUrl: fallback.url,
      directoryUrls: ['http://dir/api/gw/tunnel'],
      fetchFn: dir.fetchFn,
      primaryRetryMs: 80,
    })
    c.start()
    await until(() => a.connections() === 1)
    await a.kill() // VPS sập, danh bạ vẫn trỏ địa chỉ cũ đã chết
    await until(() => fallback.connections() >= 1, 6000)
    dir.state.wsUrl = b.url // VPS lên lại, báo tunnel mới cho Worker
    await until(() => b.connections() >= 1, 6000)
    await b.kill()
    await fallback.kill()
  })

  it('danh bạ (Worker) không trả lời được: bỏ qua, vẫn nối theo địa chỉ cấu hình và dự phòng như cũ', async () => {
    const a = await startVps()
    const dir = directory(null)
    dir.state.down = true
    const c = make({
      url: a.url,
      directoryUrls: ['http://dir/api/gw/tunnel'],
      fetchFn: dir.fetchFn,
    })
    c.start()
    await until(() => a.connections() === 1)
    await a.kill()
  })

  it('không cấu hình danh bạ: không gọi gì ra ngoài (hành vi cũ)', async () => {
    const a = await startVps()
    const dir = directory(a.url)
    const c = make({ url: a.url, fetchFn: dir.fetchFn })
    c.start()
    await until(() => a.connections() === 1)
    expect(dir.state.asked).toBe(0)
    await a.kill()
  })

  it('đang kết nối ổn định thì không hỏi danh bạ thêm (không tốn request Worker)', async () => {
    const a = await startVps()
    const dir = directory(a.url)
    const c = make({
      url: a.url,
      directoryUrls: ['http://dir/api/gw/tunnel'],
      fetchFn: dir.fetchFn,
    })
    c.start()
    await until(() => a.connections() === 1)
    await new Promise((r) => setTimeout(r, 600))
    expect(dir.state.asked).toBe(1)
    await a.kill()
  })
})
