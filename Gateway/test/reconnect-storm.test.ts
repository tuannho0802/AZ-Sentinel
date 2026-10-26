import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { CloudClient } from '../src/cloud'
import { Gateway } from '../src/gateway'

/**
 * Sự cố thật (log Cloudflare 26/10/2026): một Gateway bị chặn 403 ở cả tunnel lẫn Worker, nên cứ 1 đến 9 giây
 * lại gọi `/api/gw/tunnel` và `/api/gw/ws` (khoảng 300 request trong 37 phút). Backoff bị đặt lại mỗi lần đổi
 * địa chỉ, và danh bạ được hỏi sau mỗi lần thất bại.
 */
type Reject = { url: string; hits: () => number; close: () => Promise<void> }

async function rejectingWs(): Promise<Reject> {
  let hits = 0
  const server: Server = createServer((_req, res) => {
    res.writeHead(403).end()
  })
  server.on('upgrade', (_req, socket) => {
    hits++
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return {
    url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/gw/ws`,
    hits: () => hits,
    close: () => new Promise<void>((r) => server.close(() => r())),
  }
}

const SCALED_LIMIT = 25
const ASKED_LIMIT = 6
const stoppers: { stop: () => void }[] = []
afterEach(() => {
  for (const c of stoppers.splice(0)) c.stop()
})

describe('Gateway bị chặn ở cả hai địa chỉ: không được thử lại dồn dập', () => {
  it('trong 8 giây số lần nối và số lần hỏi danh bạ phải nhỏ', async () => {
    const tunnel = await rejectingWs()
    const worker = await rejectingWs()
    let asked = 0
    const fetchFn = (async () => {
      asked++
      return Response.json({ ok: true, origin: 'https://x', wsUrl: tunnel.url })
    }) as unknown as typeof fetch
    const gw = new Gateway({ cloudConfigured: true, idleFlushSec: 0 })
    gw.start()
    const client = new CloudClient(gw, {
      random: () => 0.5,
      // Thu nhỏ thời gian 20 lần (1 giây -> 50 ms, 60 giây -> 3 giây, 20 giây -> 1 giây): 8 giây test = hơn 2 phút thật.
      reconnectMinSec: 0.05,
      reconnectMaxSec: 3,
      directoryMinGapMs: 1000,
      pingMs: 100,
      silentMs: 1000,
      url: worker.url,
      directoryUrls: ['http://worker/api/gw/tunnel'],
      fetchFn,
      probeFetchFn: (async () => new Response(null, { status: 403 })) as unknown as typeof fetch,
    })
    stoppers.push(client, { stop: () => gw.stop() })
    client.start()

    await new Promise((r) => setTimeout(r, 8000))
    const total = tunnel.hits() + worker.hits() + asked
    // Đo trong khung thu nhỏ này: trước khi sửa 87 lần (28 nối Worker + 30 hỏi danh bạ), sau khi sửa 13 lần. Giới hạn có dư để không chập chờn.
    expect(worker.hits()).toBeGreaterThanOrEqual(1) // vòng đầu vẫn xuống dự phòng
    expect(total).toBeLessThanOrEqual(SCALED_LIMIT)
    expect(asked).toBeLessThanOrEqual(ASKED_LIMIT)

    client.stop()
    await tunnel.close()
    await worker.close()
  }, 15_000)
})
