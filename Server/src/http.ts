import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { DEVICE_HEADER, DEVICE_ID_HEADER } from '@az-sentinel/shared'
import { serve } from '@hono/node-server'
import { WebSocketServer } from 'ws'
import { type DeviceInfo, identifyDevice } from './device-id'
import { EDGE_HEADERS, verifyEdgeClientIp } from './edge-ip'
import type { IpGuard } from './ip-guard'
import { PAIR_HEADER, takePair } from './shim/cloudflare-workers'

export type Handler = (req: Request) => Response | Promise<Response>

export type HttpServerOptions = {
  port: number
  host: string
  handler: Handler
  /** Gọi sau khi một Gateway hoàn tất bắt tay WebSocket (để đồng bộ kéo sớm). */
  onGatewayConnected?: () => void
  /** Whitelist IP (Plan 3F); không truyền = không kiểm tra. */
  guard?: IpGuard
  /** Bí mật chung với Worker (`SYNC_TOKEN`) để tin IP thật do Worker chuyển (Plan 3G). Rỗng = không tin. */
  edgeSecret?: string
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
function clientIp(incoming: IncomingMessage, edgeSecret = ''): string {
  // Qua Worker của mình: IP thật nằm trong header có chữ ký (CF-Connecting-IP lúc này chỉ là IP của Worker).
  const viaEdge = verifyEdgeClientIp(edgeSecret, incoming.headers)
  if (viaEdge) return viaEdge
  const remote = incoming.socket.remoteAddress
  const given = incoming.headers[IP_HEADER]
  const first = Array.isArray(given) ? given[0] : given
  return isLoopback(remote) && first ? first : (remote ?? '')
}

/**
 * Chuẩn hóa header trước khi chuyển cho BE: IP thật vào `CF-Connecting-IP`, mã thiết bị ĐÃ BĂM vào
 * `X-AZ-Device-Id`. Mọi header cùng tên do client gửi (kể cả mã thô `X-AZ-Device`) bị gỡ để không giả được.
 */
function cleanHeaders(source: Headers, ip: string, device: DeviceInfo | null): Headers {
  const headers = new Headers(source)
  headers.delete(IP_HEADER)
  headers.delete(DEVICE_HEADER)
  headers.delete(DEVICE_ID_HEADER)
  for (const h of EDGE_HEADERS) headers.delete(h)
  if (ip) headers.set(IP_HEADER, ip)
  if (device) headers.set(DEVICE_ID_HEADER, device.id)
  return headers
}

function withClientIp(req: Request, ip: string, device: DeviceInfo | null): Request {
  return new Request(req, { headers: cleanHeaders(req.headers, ip, device) })
}

/** Gắn `Set-Cookie` (cookie thiết bị mới cấp) vào một phản hồi, giữ nguyên thân và các header khác. */
async function withSetCookie(
  res: Response | Promise<Response>,
  cookie: string | null,
): Promise<Response> {
  const out = await res
  if (!cookie) return out
  const headers = new Headers(out.headers)
  headers.append('Set-Cookie', cookie)
  return new Response(out.body, { status: out.status, statusText: out.statusText, headers })
}

const forbidden = (message: string) =>
  Response.json({ error: { code: 'FORBIDDEN', message } }, { status: 403 })

const tooManyConnections = (max: number) =>
  Response.json(
    {
      error: {
        code: 'RATE_LIMITED',
        message: `IP này đã đủ ${max} kết nối. Đóng bớt kết nối cũ hoặc nhờ quản trị viên tăng giới hạn.`,
      },
    },
    { status: 429 },
  )

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
        const ip = incoming ? clientIp(incoming, opts.edgeSecret) : ''
        const { info: device, setCookie } = incoming
          ? identifyDevice(incoming.headers, true)
          : { info: null, setCookie: null }
        if (opts.guard) {
          const decision = opts.guard.decide(ip, new URL(req.url).pathname, device)
          if (!decision.allow) {
            opts.guard.noteBlocked(ip, device)
            return withSetCookie(
              forbidden(opts.guard.describeBlock(ip, decision.reason, device)),
              setCookie,
            )
          }
        }
        return withSetCookie(
          opts.handler(incoming ? withClientIp(req, ip, device) : req),
          setCookie,
        )
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
        const ip = clientIp(incoming, opts.edgeSecret)
        const { info: device } = identifyDevice(incoming.headers, false)
        const clean = cleanHeaders(headers, ip, device)
        const url = `http://${incoming.headers.host ?? 'localhost'}${incoming.url ?? '/'}`
        const decision = opts.guard?.decide(ip, new URL(url).pathname, device) ?? {
          allow: true,
          maxConns: null,
        }
        if (!decision.allow) {
          opts.guard?.noteBlocked(ip, device)
          await writeRaw(
            socket,
            forbidden(opts.guard?.describeBlock(ip, decision.reason, device) ?? ''),
          )
          return
        }
        const res = await opts.handler(new Request(url, { method: 'GET', headers: clean }))
        const id = res.headers.get(PAIR_HEADER)
        const pair = id ? takePair(id) : null
        if (!pair) {
          await writeRaw(socket, res)
          return
        }
        // IP trong whitelist bị giới hạn số kết nối WebSocket đồng thời (mặc định 5).
        const release =
          decision.maxConns === null ? null : (opts.guard?.acquire(ip, decision.maxConns) ?? null)
        if (decision.maxConns !== null && release === null) {
          await writeRaw(socket, tooManyConnections(decision.maxConns))
          return
        }
        wss.handleUpgrade(incoming, socket, head, (real) => {
          if (release) real.on('close', release)
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
