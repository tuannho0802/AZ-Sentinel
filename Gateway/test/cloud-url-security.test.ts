import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocketServer } from 'ws'
import { CloudClient } from '../src/cloud'
import { Gateway } from '../src/gateway'
import type { Logger } from '../src/log'

/** "Worker" giả: WebSocket server loopback, ghi lại header Authorization của mọi kết nối. */
async function startWorker() {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await new Promise((r) => wss.once('listening', r))
  const auths: (string | undefined)[] = []
  wss.on('connection', (s, req) => {
    auths.push(req.headers.authorization)
    s.on('message', (d) => d.toString() === 'ping' && s.send('pong'))
  })
  return {
    url: `ws://127.0.0.1:${(wss.address() as AddressInfo).port}/api/gw/ws`,
    auths,
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

const stoppers: { stop: () => void }[] = []
/** Mọi URL mà Gateway thực sự mở WebSocket tới (kẻ tấn công nhận được token nếu URL của nó nằm ở đây). */
const opened: string[] = []
const RealWebSocket = globalThis.WebSocket
beforeEach(() => {
  opened.length = 0
  globalThis.WebSocket = class extends RealWebSocket {
    constructor(url: string | URL, init?: never) {
      opened.push(String(url))
      super(url, init)
    }
  } as typeof WebSocket
})
afterEach(() => {
  globalThis.WebSocket = RealWebSocket
  for (const c of stoppers.splice(0)) c.stop()
})

function directory(wsUrl: string) {
  let asked = 0
  const fetchFn = (async () => {
    asked++
    return Response.json({ ok: true, origin: 'https://x', wsUrl })
  }) as unknown as typeof fetch
  return { fetchFn, asked: () => asked }
}

function make(opts: ConstructorParameters<typeof CloudClient>[1]) {
  const gw = new Gateway({ cloudConfigured: true, idleFlushSec: 0 })
  gw.start()
  const client = new CloudClient(gw, { random: () => 0, pingMs: 100, silentMs: 1000, ...opts })
  stoppers.push(client, { stop: () => gw.stop() })
  return client
}

describe('danh bạ tunnel không được dẫn token tới máy chủ lạ', () => {
  it.each([
    'wss://attacker.example.net/api/gw/ws',
    'wss://evil-trycloudflare.com/api/gw/ws',
    'wss://abc.trycloudflare.com.evil.net/api/gw/ws',
    'wss://user:pw@abc.trycloudflare.com/api/gw/ws',
  ])('bỏ qua %s, vẫn nối Worker đã cấu hình và ghi cảnh báo', async (bad) => {
    const worker = await startWorker()
    const dir = directory(bad)
    const warns: string[] = []
    const log: Logger = {
      debug() {},
      info() {},
      error() {},
      warn: (m) => warns.push(m),
    }
    const token = `azt_${'B'.repeat(32)}`
    const c = make({
      url: worker.url,
      token,
      directoryUrls: ['http://worker/api/gw/tunnel'],
      fetchFn: dir.fetchFn,
      log,
    })
    c.start()
    await until(() => worker.auths.length >= 1)
    // Token chỉ tới Worker cấu hình, không bao giờ tới địa chỉ lạ (nếu bị dẫn đi thì Worker sẽ không nhận kết nối).
    expect(worker.auths[0]).toBe(`Bearer ${token}`)
    expect(dir.asked()).toBeGreaterThanOrEqual(1)
    // Gateway KHÔNG bao giờ mở kết nối (kèm token) tới địa chỉ lạ do danh bạ báo.
    expect(opened.filter((u) => u.includes(new URL(bad).hostname))).toEqual([])
    expect(opened.every((u) => u === worker.url)).toBe(true)
    expect(warns.some((w) => w.includes('không đáng tin'))).toBe(true)
    c.stop()
    await worker.kill()
  })

  it('địa chỉ danh bạ loopback (chế độ thử nghiệm) vẫn được chấp nhận và nhận token', async () => {
    // ws:// loopback chỉ dùng khi thử; trường hợp wss:// cùng host cấu hình đã có ở url-policy.test.ts.
    const worker = await startWorker()
    const other = await startWorker()
    const dir = directory(other.url)
    const c = make({
      url: worker.url,
      token: `azt_${'C'.repeat(32)}`,
      directoryUrls: ['http://worker/api/gw/tunnel'],
      fetchFn: dir.fetchFn,
    })
    c.start()
    await until(() => other.auths.length >= 1)
    expect(worker.auths).toHaveLength(0)
    c.stop()
    await worker.kill()
    await other.kill()
  })
})
