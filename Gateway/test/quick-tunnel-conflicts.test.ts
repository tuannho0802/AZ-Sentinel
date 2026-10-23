import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocketServer } from 'ws'
import { CloudClient } from '../src/cloud'
import { Gateway } from '../src/gateway'

/**
 * Cấu hình THỰC của Quick Tunnel: mã kết nối chỉ có một địa chỉ là Worker (địa chỉ dự phòng trùng địa chỉ chính nên
 * bị bỏ), nên Gateway không có `fallbackUrl`. Các test này kiểm các phần tự động hóa có chạy ĐÚNG KHI ĐI CÙNG NHAU không.
 */
async function startWs() {
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

const until = async (cond: () => boolean, ms = 8000) => {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('hết thời gian chờ điều kiện')
    await new Promise((r) => setTimeout(r, 15))
  }
}

function directory(initial: string | null) {
  const state = { wsUrl: initial as string | null, asked: 0 }
  const fetchFn = (async () => {
    state.asked++
    return Response.json({ ok: true, origin: state.wsUrl ? 'https://x' : null, wsUrl: state.wsUrl })
  }) as unknown as typeof fetch
  return { state, fetchFn }
}

const stoppers: { stop: () => void }[] = []
afterEach(() => {
  for (const c of stoppers.splice(0)) c.stop()
})

function make(opts: ConstructorParameters<typeof CloudClient>[1]) {
  const gw = new Gateway({ cloudConfigured: true, idleFlushSec: 0 })
  gw.start()
  const client = new CloudClient(gw, { random: () => 0, pingMs: 100, silentMs: 1000, ...opts })
  stoppers.push(client, { stop: () => gw.stop() })
  return client
}

const DIR = ['http://worker/api/gw/tunnel']

describe('Quick Tunnel thực tế: chỉ có địa chỉ Worker, không có fallbackUrl riêng', () => {
  it('tunnel chết mà danh bạ còn trỏ địa chỉ cũ: Gateway xuống Worker (hub dự phòng), không kẹt ở tunnel chết', async () => {
    const worker = await startWs()
    const tunnel = await startWs()
    const dir = directory(tunnel.url)
    const c = make({ url: worker.url, directoryUrls: DIR, fetchFn: dir.fetchFn })
    c.start()
    await until(() => tunnel.connections() === 1)
    expect(worker.connections()).toBe(0)

    await tunnel.kill() // VPS sập; VPS chưa báo tunnel mới nên danh bạ vẫn trả địa chỉ chết
    await until(() => worker.connections() >= 1)
    await worker.kill()
  })

  it('đang ở Worker dự phòng, VPS báo tunnel mới: tự về tunnel mới, không thao tác', async () => {
    const worker = await startWs()
    const dead = await startWs()
    const fresh = await startWs()
    const dir = directory(dead.url)
    const c = make({
      url: worker.url,
      directoryUrls: DIR,
      fetchFn: dir.fetchFn,
      primaryRetryMs: 80,
    })
    c.start()
    await until(() => dead.connections() === 1)
    await dead.kill()
    await until(() => worker.connections() >= 1)

    dir.state.wsUrl = fresh.url
    await until(() => fresh.connections() >= 1)
    await fresh.kill()
    await worker.kill()
  })

  it('danh bạ báo "chưa có tunnel" (null): nối thẳng địa chỉ Worker cấu hình', async () => {
    const worker = await startWs()
    const dir = directory(null)
    const c = make({ url: worker.url, directoryUrls: DIR, fetchFn: dir.fetchFn })
    c.start()
    await until(() => worker.connections() === 1)
    await worker.kill()
  })

  it('danh bạ trả địa chỉ không an toàn (ws:// ngoài loopback, http://): bỏ qua, vẫn nối Worker', async () => {
    const worker = await startWs()
    for (const bad of [
      'ws://evil.example.com/api/gw/ws',
      'http://evil.example.com/x',
      'javascript:1',
    ]) {
      const dir = directory(bad)
      const c = make({ url: worker.url, directoryUrls: DIR, fetchFn: dir.fetchFn })
      c.start()
      await until(() => worker.connections() >= 1)
      c.stop()
      await new Promise((r) => setTimeout(r, 50))
      expect(dir.state.asked).toBeGreaterThanOrEqual(1)
    }
    await worker.kill()
  })

  it('hai địa chỉ danh bạ trùng nhau (primary = fallback = Worker) chỉ hỏi MỘT lần', async () => {
    const worker = await startWs()
    const dir = directory(null)
    const c = make({
      url: worker.url,
      directoryUrls: [...DIR, ...DIR],
      fetchFn: dir.fetchFn,
    })
    c.start()
    await until(() => worker.connections() === 1)
    expect(dir.state.asked).toBe(1)
    await worker.kill()
  })

  it('Worker (danh bạ) sập đúng lúc VPS sập: Gateway không treo, vẫn thử nối lại địa chỉ cấu hình', async () => {
    const worker = await startWs()
    const tunnel = await startWs()
    let workerDown = false
    const fetchFn = (async () => {
      if (workerDown) throw new Error('worker sập')
      return Response.json({ ok: true, origin: 'https://x', wsUrl: tunnel.url })
    }) as unknown as typeof fetch
    const c = make({ url: worker.url, directoryUrls: DIR, fetchFn })
    c.start()
    await until(() => tunnel.connections() === 1)
    workerDown = true
    await tunnel.kill()
    // danh bạ không trả lời → vẫn phải tiếp tục thử (không dừng hẳn); khi tunnel cũ chết thì xuống địa chỉ cấu hình
    await until(() => worker.connections() >= 1)
    await worker.kill()
  })
})
