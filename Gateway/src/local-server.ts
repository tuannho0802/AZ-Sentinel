import http from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  eventRequestSchema,
  GW,
  type LocalErrorResponse,
  pingRequestSchema,
  samplesRequestSchema,
} from '@az-sentinel/shared'
import type { ZodType } from 'zod'
import type { Gateway } from './gateway'
import { type Logger, silentLogger } from './log'
import { statusPage } from './status-page'

type Handler = (body: unknown) => unknown

/**
 * Máy chủ HTTP loopback cho EA (Plan 3C mục 3). Chỉ lắng nghe 127.0.0.1, không bao giờ 0.0.0.0.
 * `WebRequest` của MQL5 chặn luồng EA nên mọi handler phải xong trong vài ms: không I/O mạng,
 * không chờ cloud. Trả lời đồng bộ từ trạng thái trong bộ nhớ.
 */
export class LocalServer {
  private server: http.Server | null = null

  constructor(
    private readonly gw: Gateway,
    private readonly port: number,
    private readonly log: Logger = silentLogger,
  ) {}

  /** Cổng thực tế đang nghe (khác `port` khi truyền 0 trong test). */
  get listeningPort(): number {
    const a = this.server?.address() as AddressInfo | null | undefined
    return a?.port ?? this.port
  }

  start(): Promise<void> {
    const routes: Record<string, Handler> = {
      '/v1/ping': this.parsed(pingRequestSchema, (b) => this.gw.handlePing(b)),
      '/v1/samples': this.parsed(samplesRequestSchema, (b) => this.gw.handleSamples(b)),
      '/v1/event': this.parsed(eventRequestSchema, (b) => this.gw.handleEvent(b)),
    }
    this.server = http.createServer((req, res) => this.onRequest(routes, req, res))
    // Không giữ kết nối nhàn rỗi quá lâu: EA mở kết nối mới mỗi WebRequest.
    this.server.keepAliveTimeout = 5000
    this.server.headersTimeout = 5000
    this.server.requestTimeout = 5000
    return new Promise((resolve, reject) => {
      const srv = this.server as http.Server
      srv.once('error', (e: NodeJS.ErrnoException) => {
        if (e.code === 'EADDRINUSE') {
          reject(new Error(`Cổng ${this.port} đang bị chiếm. Đổi "port" trong config.json.`))
        } else reject(e)
      })
      srv.listen(this.port, '127.0.0.1', () => {
        this.log.info(`giao diện và API cục bộ: http://127.0.0.1:${this.listeningPort}/`)
        resolve()
      })
    })
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) return resolve()
      this.server.closeAllConnections()
      this.server.close(() => resolve())
    })
  }

  private parsed<T>(schema: ZodType<T>, fn: (b: T) => unknown): Handler {
    return (body) => {
      const r = schema.safeParse(body)
      if (!r.success) {
        const i = r.error.issues[0]
        return fail(400, `invalid_body:${i?.path.join('.') || '-'}`)
      }
      return fn(r.data)
    }
  }

  private onRequest(
    routes: Record<string, Handler>,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    // Chống DNS rebinding: chỉ nhận Host là địa chỉ loopback của chính cổng này.
    const host = req.headers.host ?? ''
    const port = this.listeningPort
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      send(res, fail(403, 'bad_host'))
      return
    }
    const url = (req.url ?? '/').split('?')[0] ?? '/'

    if (req.method === 'GET' && url === '/') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(statusPage())
      return
    }
    if (req.method === 'GET' && url === '/v1/status') {
      send(res, this.gw.status())
      return
    }

    const handler = routes[url]
    if (!handler) {
      send(res, fail(404, 'not_found'))
      return
    }
    if (req.method !== 'POST') {
      send(res, fail(405, 'method_not_allowed'))
      return
    }

    readBody(req, GW.maxBodyBytes).then(
      (raw) => {
        let body: unknown
        try {
          body = JSON.parse(raw)
        } catch {
          send(res, fail(400, 'invalid_json'))
          return
        }
        try {
          send(res, handler(body))
        } catch (e) {
          this.log.error(`lỗi xử lý ${url}: ${e instanceof Error ? e.message : String(e)}`)
          send(res, fail(500, 'internal'))
        }
      },
      () => {
        res.shouldKeepAlive = false
        send(res, fail(413, 'too_large'))
      },
    )
  }
}

type Failure = { __status: number; body: LocalErrorResponse }

function fail(status: number, error: string): Failure {
  return { __status: status, body: { ok: false, error } }
}

function isFailure(v: unknown): v is Failure {
  return typeof v === 'object' && v !== null && '__status' in v
}

/** JSON gọn một dòng, không khoảng trắng: EA (MQL5) tách trường bằng tìm chuỗi đơn giản. */
function send(res: http.ServerResponse, payload: unknown): void {
  const status = isFailure(payload) ? payload.__status : 200
  const body = JSON.stringify(isFailure(payload) ? payload.body : payload)
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

function readBody(req: http.IncomingMessage, max: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let over = false
    req.on('data', (c: Buffer) => {
      if (over) return // bỏ phần thừa, không giữ trong bộ nhớ
      size += c.length
      if (size > max) {
        over = true
        chunks.length = 0
        reject(new Error('too_large'))
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}
