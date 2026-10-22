import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { serve } from '@hono/node-server'
import { WebSocketServer } from 'ws'
import { PAIR_HEADER, takePair } from './shim/cloudflare-workers'

export type Handler = (req: Request) => Response | Promise<Response>

export type HttpServerOptions = {
  port: number
  host: string
  handler: Handler
  /** Gọi sau khi một Gateway hoàn tất bắt tay WebSocket (để đồng bộ kéo sớm). */
  onGatewayConnected?: () => void
}

const IP_HEADER = 'cf-connecting-ip'

function isLoopback(addr: string | undefined): boolean {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
}

/**
 * IP thật của client, đặt vào `CF-Connecting-IP` (BE đọc header này để giới hạn tần suất và ghi log).
 * Chỉ tin header do Cloudflare Tunnel/reverse proxy gửi khi kết nối tới từ loopback; kết nối trực tiếp
 * (LAN) thì dùng địa chỉ socket để client không tự giả IP.
 */
function clientIp(incoming: IncomingMessage): string {
  const remote = incoming.socket.remoteAddress
  const given = incoming.headers[IP_HEADER]
  const first = Array.isArray(given) ? given[0] : given
  return isLoopback(remote) && first ? first : (remote ?? '')
}

function withClientIp(req: Request, ip: string): Request {
  const headers = new Headers(req.headers)
  headers.delete(IP_HEADER)
  if (ip) headers.set(IP_HEADER, ip)
  return new Request(req, { headers })
}

/** Trả một phản hồi HTTP thường qua socket thô (khi yêu cầu nâng cấp WebSocket bị từ chối). */
async function writeRaw(socket: Duplex, res: Response): Promise<void> {
  const body = Buffer.from(await res.arrayBuffer())
  const lines = [`HTTP/1.1 ${res.status} ${res.statusText || 'Error'}`]
  res.headers.forEach((value, key) => {
    if (key !== 'content-length' && key !== 'transfer-encoding') lines.push(`${key}: ${value}`)
  })
  lines.push(`Content-Length: ${body.length}`, 'Connection: close', '', '')
  socket.end(Buffer.concat([Buffer.from(lines.join('\r\n')), body]))
}

/**
 * Máy chủ HTTP của VPS: `@hono/node-server` cho request thường; nâng cấp WebSocket tự xử lý vì Node
 * không tạo được `Response` 101. Luồng: dựng `Request` giả có header Upgrade, chạy qua đúng app Hono;
 * hub (shim) trả phản hồi mang mã cặp socket (`PAIR_HEADER`); ta bắt tay bằng `ws` rồi gắn socket thật
 * vào đầu server của cặp. Phản hồi không mang mã (401, 403...) được ghi nguyên văn ra socket.
 */
export function startHttpServer(opts: HttpServerOptions): Server {
  const server = serve(
    {
      port: opts.port,
      hostname: opts.host,
      fetch: (req, env) => {
        const incoming = (env as { incoming?: IncomingMessage } | undefined)?.incoming
        return opts.handler(incoming ? withClientIp(req, clientIp(incoming)) : req)
      },
    },
    () => {},
  ) as Server

  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (incoming: IncomingMessage, socket: Duplex, head: Buffer) => {
    void (async () => {
      try {
        const headers = new Headers()
        for (const [key, value] of Object.entries(incoming.headers)) {
          if (value === undefined) continue
          for (const v of Array.isArray(value) ? value : [value]) headers.append(key, v)
        }
        headers.delete(IP_HEADER)
        const ip = clientIp(incoming)
        if (ip) headers.set(IP_HEADER, ip)
        const url = `http://${incoming.headers.host ?? 'localhost'}${incoming.url ?? '/'}`
        const res = await opts.handler(new Request(url, { method: 'GET', headers }))
        const id = res.headers.get(PAIR_HEADER)
        const pair = id ? takePair(id) : null
        if (!pair) {
          await writeRaw(socket, res)
          return
        }
        wss.handleUpgrade(incoming, socket, head, (real) => {
          pair.bind(real)
          if (pair.tags.includes('gw')) opts.onGatewayConnected?.()
        })
      } catch {
        socket.destroy()
      }
    })()
  })
  server.on('close', () => wss.close())
  return server
}
