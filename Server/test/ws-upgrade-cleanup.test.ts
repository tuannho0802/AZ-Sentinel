import type { AddressInfo } from 'node:net'
import { connect } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { startHttpServer } from '../src/http'
import type { IpGuard } from '../src/ip-guard'
import { ShimState } from '../src/shim/cloudflare-workers'

type PairCtor = new () => [unknown, import('../src/shim/cloudflare-workers').ShimWebSocket]

const servers: { close: () => void }[] = []
afterEach(() => {
  for (const s of servers.splice(0)) s.close()
})

/** Hub giả: mỗi lần nâng cấp tạo một socket "gw" như LiveHub thật (acceptWebSocket rồi trả mã cặp). */
function boot(maxConns: number) {
  const state = new ShimState()
  let open = 0
  const guard = {
    decide: () => ({ allow: true, maxConns }),
    noteBlocked: () => {},
    describeBlock: () => '',
    acquire: (_ip: string, max: number) => {
      if (open >= max) return null
      open++
      let done = false
      return () => {
        if (done) return
        done = true
        open--
      }
    },
  } as unknown as IpGuard
  const handler = async () => {
    const g = globalThis as unknown as {
      WebSocketPair: PairCtor
      __azUpgrade: (c: unknown) => Response
    }
    const pair = new g.WebSocketPair()
    state.acceptWebSocket(pair[1], ['gw'])
    return g.__azUpgrade(pair[0])
  }
  const server = startHttpServer({ port: 0, host: '127.0.0.1', handler, guard })
  servers.push(server)
  const ready = new Promise<number>((resolve) =>
    server.once('listening', () => resolve((server.address() as AddressInfo).port)),
  )
  return { state, ready, openConns: () => open }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('nâng cấp WebSocket thất bại không để lại socket ma trong hub', () => {
  it('IP đã đủ số kết nối: kết nối bị từ chối (429) không được tính là gateway', async () => {
    const { state, ready } = boot(1)
    const port = await ready
    const first = new WebSocket(`ws://127.0.0.1:${port}/`)
    await new Promise((r) => first.once('open', r))
    const second = new WebSocket(`ws://127.0.0.1:${port}/`)
    const status = await new Promise<number>((resolve) =>
      second.once('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0)),
    )
    expect(status).toBe(429)
    await wait(50)
    expect(state.getWebSockets('gw')).toHaveLength(1)
    first.close()
  })

  it('bắt tay sai (thiếu Sec-WebSocket-Key): không rò chỗ kết nối và không để socket ma', async () => {
    const { state, ready, openConns } = boot(5)
    const port = await ready
    const raw = connect(port, '127.0.0.1')
    raw.resume()
    raw.write('GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n')
    await new Promise((r) => raw.once('close', r))
    await wait(50)
    expect(openConns()).toBe(0)
    expect(state.getWebSockets('gw')).toHaveLength(0)
  })
})
