import http from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  alertRequestSchema,
  eventRequestSchema,
  GW,
  type LocalErrorResponse,
  pingRequestSchema,
  samplesRequestSchema,
  tradeResultRequestSchema,
} from '@az-sentinel/shared'
import type { ZodType } from 'zod'
import { applyConnectCodeToBody, type EditableConfig, editableSchema } from './config'
import type { Gateway } from './gateway'
import { type Logger, silentLogger } from './log'
import { statusPage } from './status-page'
import type { UpdateInfo } from './update-check'

type Handler = (body: unknown) => unknown

/**
 * Phần giao diện quản trị (cấu hình, log, cập nhật). Không bắt buộc: thiếu thì các route này 404,
 * nên test cũ và `fake-ea` không đổi.
 */
export type UiHooks = {
  /** Cấu hình hiện tại cho giao diện; KHÔNG chứa token, chỉ cờ `tokenSet`. */
  getConfig: () => Omit<EditableConfig, 'cloudToken'> & {
    tokenSet: boolean
    port: number
    /**
     * Đang chạy dưới `run-gateway.cmd`. Chỉ khi đó "Tắt hoàn toàn" mới có nghĩa (có người giám sát
     * để đọc cờ); chạy tay hoặc `pnpm dev` thì giao diện ẩn nút.
     */
    supervised: boolean
  }
  saveConfig: (c: EditableConfig) => void
  getUpdate: () => UpdateInfo | null
  /** Vài trăm dòng log cuối, mới nhất ở cuối. */
  tailLog: (lines: number) => string
  /** Thoát tiến trình để trình giám sát (run-gateway.cmd) bật lại với cấu hình mới. */
  restart: () => void
  /**
   * Tắt hoàn toàn: ghi cờ `disabled.flag` rồi thoát. Ném lỗi nếu không ghi được cờ hoặc không chạy
   * dưới người giám sát; khi đó route trả 500 và Gateway KHÔNG thoát.
   */
  shutdown: () => void
}

/**
 * Máy chủ HTTP loopback cho EA (Plan 3C mục 3). Chỉ lắng nghe 127.0.0.1, không bao giờ 0.0.0.0.
 * `WebRequest` của MQL5 chặn luồng EA nên mọi handler phải xong trong vài ms: không I/O mạng,
 * không chờ cloud. Trả lời đồng bộ từ trạng thái trong bộ nhớ.
 */
export class LocalServer {
  private server: http.Server | null = null
  private readonly rejectedHosts = new Set<string>()

  constructor(
    private readonly gw: Gateway,
    private readonly port: number,
    private readonly log: Logger = silentLogger,
    private readonly ui: UiHooks | null = null,
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
      '/v1/alert': this.parsed(
        alertRequestSchema,
        (b) => this.gw.handleAlert(b) ?? fail(409, 'unknown_terminal'),
      ),
      '/v1/trade_result': this.parsed(
        tradeResultRequestSchema,
        (b) => this.gw.handleTradeResult(b) ?? fail(409, 'unknown_terminal'),
      ),
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

  /** Ghi log mỗi giá trị Host bị từ chối một lần (tối đa 5 giá trị) để biết client gửi gì mà không tràn log. */
  private warnBadHost(host: string): void {
    const shown = JSON.stringify(host.slice(0, 100))
    if (this.rejectedHosts.has(shown) || this.rejectedHosts.size >= 5) return
    this.rejectedHosts.add(shown)
    this.log.warn(
      `từ chối request: header Host ${shown} không phải loopback (cổng ${this.listeningPort})`,
    )
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
    // Chống DNS rebinding: chỉ nhận Host là hostname loopback. Cổng trong Host là tùy chọn vì
    // `WebRequest` của MT5 có thể không gửi kèm cổng (xem isLoopbackHost).
    const host = req.headers.host ?? ''
    if (!isLoopbackHost(host, this.listeningPort)) {
      this.warnBadHost(host)
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

    if (this.ui && url.startsWith('/v1/ui/')) {
      this.onUi(url, req, res)
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

    this.readJson(req, res, (body) => send(res, handler(body)), url)
  }

  /** Đọc thân JSON (tối đa `GW.maxBodyBytes`) rồi gọi `fn`. Lỗi đọc, JSON hỏng đều trả 4xx. */
  private readJson(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    fn: (body: unknown) => void,
    url: string,
  ): void {
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
          fn(body)
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

  /**
   * API của giao diện cục bộ. Ngoài kiểm tra Host (loopback), các route GHI còn đòi header
   * `x-az-ui: 1` (trình duyệt buộc preflight nếu trang lạ cố gọi, mà Gateway không trả CORS) và,
   * nếu có `Origin`, phải là chính Gateway. Chặn trang web bất kỳ trên máy VPS sửa cấu hình.
   */
  private onUi(url: string, req: http.IncomingMessage, res: http.ServerResponse): void {
    const ui = this.ui as UiHooks
    if (req.method === 'GET' && url === '/v1/ui/config') {
      send(res, ui.getConfig())
      return
    }
    if (req.method === 'GET' && url === '/v1/ui/update') {
      send(res, ui.getUpdate() ?? { available: false })
      return
    }
    if (req.method === 'GET' && url === '/v1/ui/log') {
      res.writeHead(200, {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(ui.tailLog(200))
      return
    }
    if (
      req.method !== 'POST' ||
      (url !== '/v1/ui/config' && url !== '/v1/ui/restart' && url !== '/v1/ui/shutdown')
    ) {
      send(res, fail(404, 'not_found'))
      return
    }
    const origin = req.headers.origin
    const okOrigin =
      origin === undefined ||
      origin === `http://127.0.0.1:${this.listeningPort}` ||
      origin === `http://localhost:${this.listeningPort}`
    if (req.headers['x-az-ui'] !== '1' || !okOrigin) {
      send(res, fail(403, 'bad_origin'))
      return
    }
    if (url === '/v1/ui/shutdown') {
      // Ghi cờ TRƯỚC khi trả lời: nếu ghi lỗi thì báo 500 và Gateway vẫn chạy, không giả vờ đã tắt.
      try {
        ui.shutdown()
      } catch (e) {
        this.log.error(`không tắt được Gateway: ${e instanceof Error ? e.message : String(e)}`)
        send(res, fail(500, 'shutdown_failed'))
        return
      }
      send(res, { ok: true })
      return
    }
    if (url === '/v1/ui/restart') {
      send(res, { ok: true })
      setTimeout(() => ui.restart(), 300)
      return
    }
    this.readJson(
      req,
      res,
      (body) => {
        const applied = applyConnectCodeToBody(body)
        if (!applied.ok) {
          send(res, fail(400, applied.error))
          return
        }
        const r = editableSchema.safeParse(applied.body)
        if (!r.success) {
          const i = r.error.issues[0]
          send(res, fail(400, `invalid_body:${i?.path.join('.') || '-'}:${i?.message ?? ''}`))
          return
        }
        ui.saveConfig(r.data)
        this.log.info('cấu hình được cập nhật từ giao diện cục bộ')
        send(res, { ok: true })
      },
      url,
    )
  }
}

/**
 * Host hợp lệ khi hostname chính xác là `127.0.0.1` hoặc `localhost` (không phân biệt hoa thường).
 * Cổng là tùy chọn; nếu có thì phải đúng cổng đang nghe. Chống DNS rebinding dựa vào hostname
 * (kẻ tấn công luôn gửi tên miền của họ), nên không bắt buộc phải có cổng.
 */
export function isLoopbackHost(header: string, port: number): boolean {
  const m = /^(?:127\.0\.0\.1|localhost)(?::(\d{1,5}))?$/i.exec(header.trim())
  if (!m) return false
  return m[1] === undefined || Number(m[1]) === port
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
