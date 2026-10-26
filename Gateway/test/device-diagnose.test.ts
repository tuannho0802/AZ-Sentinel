import type { IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocketServer } from 'ws'
import { CloudClient, describeStatus } from '../src/cloud'
import { Gateway } from '../src/gateway'
import type { Logger } from '../src/log'

const TOKEN = 'azt_0123456789abcdef0123456789abcdef'
const DEVICE = 'dev_raw_0123456789abcdefABCDEF'

const until = async (cond: () => boolean, ms = 5000) => {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('hết thời gian chờ điều kiện')
    await new Promise((r) => setTimeout(r, 15))
  }
}

/** Địa chỉ ws:// trên cổng vừa đóng: nối vào sẽ bị từ chối (mô phỏng tunnel chết / máy chủ không với tới). */
async function deadUrl() {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await new Promise((r) => wss.once('listening', r))
  const port = (wss.address() as AddressInfo).port
  await new Promise<void>((r) => wss.close(() => r()))
  return { port, url: `ws://127.0.0.1:${port}/api/gw/ws` }
}

function captureLog() {
  const lines: string[] = []
  const log: Logger = {
    debug: () => {},
    info: (m) => lines.push(m),
    warn: (m) => lines.push(m),
    error: (m) => lines.push(m),
  }
  return { lines, log }
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

describe('Gateway gửi danh tính khi bắt tay WebSocket', () => {
  it('mang token cá nhân và mã thiết bị (X-AZ-Device) để qua được bảo vệ thiết bị của Server', async () => {
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' })
    await new Promise((r) => wss.once('listening', r))
    const seen: IncomingHttpHeaders[] = []
    wss.on('connection', (_s, req) => seen.push(req.headers))
    try {
      const url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}/api/gw/ws`
      make({ url, token: TOKEN, deviceId: DEVICE }).start()
      await until(() => seen.length > 0)
      expect(seen[0]?.authorization).toBe(`Bearer ${TOKEN}`)
      expect(seen[0]?.['x-az-device']).toBe(DEVICE)
    } finally {
      for (const c of opened.splice(0)) c.stop()
      await new Promise<void>((r) => wss.close(() => r()))
    }
  })
})

describe('Gateway ghi lý do thật khi không nối được cloud', () => {
  it('đọc lý do 403 do Server trả (thiết bị lạ) và không ghi token vào log', async () => {
    const dead = await deadUrl()
    const { lines, log } = captureLog()
    const calls: { url: string; headers: Headers }[] = []
    const probeFetchFn = (async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: new Headers(init?.headers) })
      return Response.json(
        {
          error: {
            code: 'FORBIDDEN',
            message: 'Không nhận diện được thiết bị (IP 1.2.3.4). Hãy cập nhật Gateway.',
          },
        },
        { status: 403 },
      )
    }) as unknown as typeof fetch

    make({ url: dead.url, token: TOKEN, deviceId: DEVICE, log, probeFetchFn }).start()
    await until(() => lines.some((l) => l.includes('chẩn đoán')))

    const diag = lines.find((l) => l.includes('chẩn đoán')) ?? ''
    expect(diag).toContain(`127.0.0.1:${dead.port}`)
    expect(diag).toContain('máy chủ chặn Gateway')
    expect(diag).toContain('Không nhận diện được thiết bị')
    expect(calls[0]?.url).toBe(`http://127.0.0.1:${dead.port}/api/gw/check`)
    expect(calls[0]?.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`)
    expect(calls[0]?.headers.get('X-AZ-Device')).toBe(DEVICE)
    expect(lines.join('\n')).not.toContain(TOKEN)
    expect(lines.join('\n')).not.toContain(DEVICE)
  })

  it('nối hỏng nhiều lần liên tiếp chỉ chẩn đoán một lần (không tốn request Worker)', async () => {
    const dead = await deadUrl()
    const { lines, log } = captureLog()
    let probes = 0
    const probeFetchFn = (async () => {
      probes++
      return new Response('x', { status: 530 })
    }) as unknown as typeof fetch

    make({ url: dead.url, token: TOKEN, deviceId: DEVICE, log, probeFetchFn }).start()
    // backoff 0,5s rồi 1s: chờ tới khi đã hỏng ít nhất 3 lần
    await until(() => lines.filter((l) => l.includes('không nối được cloud')).length >= 3, 6000)
    expect(probes).toBe(1)
    expect(lines.filter((l) => l.includes('chẩn đoán')).length).toBe(1)
    expect(lines.find((l) => l.includes('chẩn đoán'))).toContain('HTTP 530')
  })

  it('không tới được máy chủ qua HTTP thì báo lỗi mạng/DNS/tường lửa', async () => {
    const dead = await deadUrl()
    const { lines, log } = captureLog()
    const probeFetchFn = (async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch
    make({ url: dead.url, token: TOKEN, log, probeFetchFn }).start()
    await until(() => lines.some((l) => l.includes('chẩn đoán')))
    expect(lines.find((l) => l.includes('chẩn đoán'))).toContain('không tới được máy chủ qua HTTP')
  })
})

describe('describeStatus', () => {
  it.each([
    [200, '', 'tường lửa/proxy'],
    [401, '', 'token bị từ chối'],
    [403, 'Thiết bị này (mã 33ff355d) chưa được cho phép', 'mã 33ff355d'],
    [403, '', 'Whitelist IP hoặc thiết bị'],
    [429, 'IP này đã đủ 5 kết nối', 'đã đủ 5 kết nối'],
    [530, '', 'HTTP 530'],
    [418, '', 'HTTP 418'],
  ])('mã %i (%s) nêu đúng lý do', (status, detail, expected) => {
    expect(describeStatus(status, detail)).toContain(expected)
  })
})
