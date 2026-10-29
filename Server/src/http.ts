import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'
import {
  applySecurityHeaders,
  DEVICE_COOKIE,
  DEVICE_HEADER,
  DEVICE_ID_HEADER,
} from '@az-sentinel/shared'
import { serve } from '@hono/node-server'
import { WebSocketServer } from 'ws'
import { HandoffNonces, handleDeviceHandoff } from './device-handoff'
import { type DeviceInfo, identifyDevice, isHttps } from './device-id'
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

/**
 * Gắn `Set-Cookie` (cookie thiết bị mới cấp) và header bảo mật vào một phản hồi, giữ nguyên thân và các header
 * khác. Header bảo mật (CSP, chống nhúng iframe, HSTS khi HTTPS...) áp cho MỌI phản hồi của request thường,
 * kể cả 403 của whitelist và 302 trao mã thiết bị.
 */
async function withSetCookie(
  res: Response | Promise<Response>,
  cookie: string | null,
  extra: Record<string, string> | undefined,
  sec: { api: boolean; https: boolean },
): Promise<Response> {
  const out = await res
  const headers = new Headers(out.headers)
  if (cookie) headers.append('Set-Cookie', cookie)
  for (const [k, v] of Object.entries(extra ?? {})) headers.set(k, v)
  applySecurityHeaders(headers, sec.api ? 'api' : 'ui', sec.https)
  return new Response(out.body, { status: out.status, statusText: out.statusText, headers })
}

/** Lượt tải trang của trình duyệt (cùng tiêu chí với `isPageNavigation` của Worker). */
function isDocumentRequest(h: IncomingMessage['headers']): boolean {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const dest = first(h['sec-fetch-dest'])
  if (dest) return dest === 'document'
  return (first(h.accept) ?? '').includes('text/html')
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
  const nonces = new HandoffNonces()
  const server = serve(
    {
      port: opts.port,
      hostname: opts.host,
      fetch: async (req, env) => {
        const incoming = (env as { incoming?: IncomingMessage } | undefined)?.incoming
        // Plan 3K: vé trao mã thiết bị từ Worker. Chỉ đặt cookie, không chạm dữ liệu nên xử lý trước whitelist.
        // Lượt tải trang của trình duyệt được phục vụ NGAY (một vòng mạng qua tunnel, không còn 302 sang URL sạch):
        // cookie gắn vào chính phản hồi, mã thiết bị dùng luôn cho request này, và giao diện tự gỡ tham số vé khỏi
        // thanh địa chỉ (`dropStayParam`). Request khác (không phải tải trang) vẫn chuyển hướng như cũ.
        const sec = {
          api: new URL(req.url).pathname.startsWith('/api/'),
          https: incoming ? isHttps(incoming.headers) : false,
        }
        let handoffCookie: string | null = null
        let forwarded = req
        let seenHeaders = incoming?.headers
        if (incoming && req.method === 'GET') {
          const clean = new URL(req.url) // handleDeviceHandoff gỡ tham số vé ngay trên đối tượng này
          const handoff = await handleDeviceHandoff(
            clean,
            incoming.headers,
            opts.edgeSecret ?? '',
            nonces,
          )
          if (handoff) {
            if (!isDocumentRequest(incoming.headers)) {
              const headers = new Headers({
                Location: handoff.location,
                'Cache-Control': 'no-store',
                'Referrer-Policy': 'no-referrer',
              })
              if (handoff.setCookie) headers.append('Set-Cookie', handoff.setCookie)
              applySecurityHeaders(headers, 'ui', sec.https)
              return new Response(null, { status: 302, headers })
            }
            forwarded = new Request(clean, { method: 'GET', headers: req.headers })
            if (handoff.setCookie && handoff.raw) {
              handoffCookie = handoff.setCookie
              const old = incoming.headers.cookie
              seenHeaders = {
                ...incoming.headers,
                cookie: `${DEVICE_COOKIE}=${handoff.raw}${old ? `; ${old}` : ''}`,
              }
            }
          }
        }
        const ip = incoming ? clientIp(incoming, opts.edgeSecret) : ''
        const { info: device, setCookie: minted } =
          incoming && seenHeaders
            ? identifyDevice(seenHeaders, true)
            : { info: null, setCookie: null }
        const setCookie = handoffCookie ?? minted
        const extra = handoffCookie ? { 'Referrer-Policy': 'no-referrer' } : undefined
        if (opts.guard) {
          const decision = opts.guard.decide(ip, new URL(req.url).pathname, device)
          if (!decision.allow) {
            opts.guard.noteBlocked(ip, device)
            return withSetCookie(
              forbidden(opts.guard.describeBlock(ip, decision.reason, device)),
              setCookie,
              extra,
              sec,
            )
          }
        }
        return withSetCookie(
          opts.handler(incoming ? withClientIp(forwarded, ip, device) : forwarded),
          setCookie,
          extra,
          sec,
        )
      },
    },
    () => {},
  ) as Server

  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (incoming: IncomingMessage, socket: Duplex, head: Buffer) => {
    void (async () => {
      // Cặp socket đã lấy khỏi hàng đợi nhưng chưa gắn socket thật: hẹn giờ 30 giây của shim không còn dọn nó
      // nữa, nên mọi đường thoát giữa chừng phải tự `abandon()`, nếu không hub giữ mãi một gateway "ma"
      // (tính vào số gateway đang mở và dồn hàng đợi tin gửi).
      let pending: ReturnType<typeof takePair> = null
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
        pending = pair
        // IP trong whitelist bị giới hạn số kết nối WebSocket đồng thời (mặc định 5).
        const release =
          decision.maxConns === null ? null : (opts.guard?.acquire(ip, decision.maxConns) ?? null)
        if (decision.maxConns !== null && release === null) {
          pair.abandon()
          pending = null
          await writeRaw(socket, tooManyConnections(decision.maxConns))
          return
        }
        // `ws` KHÔNG gọi callback khi bắt tay hỏng (thiếu/sai Sec-WebSocket-Key, client đã ngắt trong lúc chờ...):
        // lúc đó phải trả chỗ kết nối và bỏ cặp socket theo sự kiện đóng của socket thô.
        let bound = false
        const cleanup = () => {
          if (bound) return
          release?.()
          pair.abandon()
        }
        socket.once('close', cleanup)
        wss.handleUpgrade(incoming, socket, head, (real) => {
          bound = true
          pending = null
          if (release) real.on('close', release)
          pair.bind(real)
          if (pair.tags.includes('gw')) opts.onGatewayConnected?.()
        })
        if (!bound && socket.destroyed) cleanup()
      } catch {
        pending?.abandon()
        socket.destroy()
      }
    })()
  })
  server.on('close', () => wss.close())
  return server
}
