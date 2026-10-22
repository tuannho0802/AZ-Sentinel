import { GW, gwServerMessageSchema } from '@az-sentinel/shared'
import type { Gateway } from './gateway'
import { type Logger, silentLogger } from './log'

export type CloudOptions = {
  url: string
  /**
   * Địa chỉ dự phòng (Plan 3E), thường là Worker Cloudflare. Khi `url` (VPS chính) không nối được 2 lần liên
   * tiếp thì chuyển sang đây; trong lúc dùng dự phòng, cứ `primaryRetryMs` lại thử `url` và quay về khi được.
   */
  fallbackUrl?: string
  /** Chu kỳ thử quay về địa chỉ chính khi đang dùng dự phòng (ms). Mặc định 60 giây. */
  primaryRetryMs?: number
  /** Bí mật chung gửi bằng `Authorization: Bearer`; rỗng = không gửi (chỉ dùng khi chạy dev). */
  token?: string
  log?: Logger
  /** Chỉ để kiểm thử: nhân bản bộ ngẫu nhiên cho jitter. */
  random?: () => number
  /** Chỉ để kiểm thử: rút ngắn khoảng ping và hạn im lặng (ms). */
  pingMs?: number
  silentMs?: number
}

/**
 * Một WebSocket bền từ Gateway ra `LiveHub` (Plan 3C mục 4). Nối lại theo backoff 1, 2, 4...
 * tối đa 60 giây có jitter. Giữ nhịp bằng tin văn bản "ping": hub đáp "pong" tự động bằng
 * `setWebSocketAutoResponse` nên không đánh thức Durable Object (không tính phí request).
 * Quá `silentMs` không nhận được gì (kể cả pong) thì coi là chết và nối lại.
 */
export class CloudClient {
  private ws: WebSocket | null = null
  private attempt = 0
  private stopped = false
  private retryTimer: NodeJS.Timeout | null = null
  private pingTimer: NodeJS.Timeout | null = null
  private lastRx = 0
  /** 0 = địa chỉ chính, 1 = dự phòng. */
  private urlIndex = 0
  private failStreak = 0
  private probeTimer: NodeJS.Timeout | null = null
  private readonly log: Logger
  private readonly rand: () => number
  private readonly pingMs: number
  private readonly silentMs: number

  constructor(
    private readonly gw: Gateway,
    private readonly opts: CloudOptions,
  ) {
    this.log = opts.log ?? silentLogger
    this.rand = opts.random ?? Math.random
    this.pingMs = opts.pingMs ?? GW.wsPingSec * 1000
    this.silentMs = opts.silentMs ?? GW.wsPingSec * 2.5 * 1000
  }

  start(): void {
    this.stopped = false
    this.connect()
  }

  stop(): void {
    this.stopped = true
    if (this.retryTimer) clearTimeout(this.retryTimer)
    if (this.pingTimer) clearInterval(this.pingTimer)
    if (this.probeTimer) clearInterval(this.probeTimer)
    this.retryTimer = this.pingTimer = this.probeTimer = null
    const ws = this.ws
    this.ws = null
    if (ws) {
      this.gw.onCloudClose()
      ws.close(1000, 'gateway stopping')
    }
  }

  /** Địa chỉ đang dùng (chính hoặc dự phòng). */
  private currentUrl(): string {
    return this.urlIndex === 1 && this.opts.fallbackUrl ? this.opts.fallbackUrl : this.opts.url
  }

  /** Mở một WebSocket tới `url` kèm token (WebSocket toàn cục của Node/undici nhận `headers`). */
  private open(url: string): WebSocket {
    const init = this.opts.token
      ? { headers: { Authorization: `Bearer ${this.opts.token}` } }
      : undefined
    return init
      ? new (WebSocket as unknown as new (url: string, init: object) => WebSocket)(url, init)
      : new WebSocket(url)
  }

  private connect(): void {
    if (this.stopped) return
    let ws: WebSocket
    let opened = false
    try {
      ws = this.open(this.currentUrl())
    } catch (e) {
      this.log.error(`URL cloud không hợp lệ: ${e instanceof Error ? e.message : String(e)}`)
      return
    }
    this.ws = ws

    ws.addEventListener('open', () => {
      opened = true
      this.attempt = 0
      this.lastRx = Date.now()
      this.log.info(`đã nối cloud (${this.urlIndex === 0 ? 'chính' : 'dự phòng'})`)
      if (this.urlIndex === 1) this.startProbingPrimary()
      this.gw.onCloudOpen((msg) => {
        if (this.ws !== ws || ws.readyState !== WebSocket.OPEN) return false
        ws.send(JSON.stringify(msg))
        return true
      })
      this.pingTimer = setInterval(() => this.keepAlive(ws), this.pingMs)
      this.pingTimer.unref?.()
    })

    ws.addEventListener('message', (ev) => {
      this.lastRx = Date.now()
      if (typeof ev.data !== 'string' || ev.data === 'pong') return
      let json: unknown
      try {
        json = JSON.parse(ev.data)
      } catch {
        return
      }
      const parsed = gwServerMessageSchema.safeParse(json)
      if (parsed.success) this.gw.onCloudMessage(parsed.data)
      else this.log.warn('bỏ qua tin cloud không hợp lệ')
    })

    ws.addEventListener('close', () => this.onClosed(ws, opened))
    ws.addEventListener('error', () => {
      // `close` luôn theo sau `error`; xử lý ở đó để không lên lịch nối lại hai lần.
    })
  }

  private keepAlive(ws: WebSocket): void {
    if (this.ws !== ws) return
    if (Date.now() - this.lastRx > this.silentMs) {
      this.log.warn('cloud im lặng quá lâu, nối lại')
      ws.close(4000, 'silent')
      return
    }
    if (ws.readyState === WebSocket.OPEN) ws.send('ping')
  }

  /**
   * Thử mở địa chỉ chính trong lúc đang dùng dự phòng; mở được thì đóng thử và đóng kết nối dự phòng để
   * `onClosed` nối lại vào địa chỉ chính. Kết nối thử không gửi `hello` nên hub tự đóng sau vài giây.
   */
  private startProbingPrimary(): void {
    if (this.probeTimer || !this.opts.fallbackUrl) return
    this.probeTimer = setInterval(() => {
      if (this.stopped || this.urlIndex !== 1) return
      let probe: WebSocket
      try {
        probe = this.open(this.opts.url)
      } catch {
        return
      }
      const giveUp = setTimeout(() => probe.close(), 8000)
      probe.addEventListener('open', () => {
        clearTimeout(giveUp)
        probe.close(1000, 'probe')
        this.log.info('địa chỉ chính đã sống lại, chuyển về')
        this.switchTo(0)
      })
      probe.addEventListener('error', () => clearTimeout(giveUp))
    }, this.opts.primaryRetryMs ?? 60_000)
    this.probeTimer.unref?.()
  }

  private stopProbing(): void {
    if (this.probeTimer) clearInterval(this.probeTimer)
    this.probeTimer = null
  }

  /** Đổi địa chỉ rồi đóng kết nối hiện tại; `onClosed` sẽ nối lại vào địa chỉ mới. */
  private switchTo(index: 0 | 1): void {
    this.urlIndex = index
    this.failStreak = 0
    this.attempt = 0
    if (index === 0) this.stopProbing()
    this.ws?.close(1000, 'switch')
  }

  private onClosed(ws: WebSocket, opened: boolean): void {
    if (this.ws !== ws) return // kết nối cũ đã bị thay hoặc dừng chủ động
    this.ws = null
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.pingTimer = null
    this.gw.onCloudClose()
    if (this.stopped) return
    // Đã nối được rồi rớt tính 1 lần lỗi; không nối được tính thêm 1: hai lần liền thì đổi địa chỉ.
    this.failStreak = opened ? 1 : this.failStreak + 1
    if (this.opts.fallbackUrl && this.urlIndex === 0 && this.failStreak >= 2) {
      this.log.warn('địa chỉ chính không nối được, chuyển sang dự phòng')
      this.urlIndex = 1
      this.failStreak = 0
      this.attempt = 0
    } else if (this.urlIndex === 1 && !opened && this.failStreak >= 2) {
      // Dự phòng cũng hỏng: thử lại địa chỉ chính (VPS có thể đã sống lại).
      this.urlIndex = 0
      this.failStreak = 0
      this.stopProbing()
    }
    const base = Math.min(GW.reconnectMaxSec, GW.reconnectMinSec * 2 ** this.attempt)
    const delay = Math.round(base * 1000 * (0.5 + this.rand() * 0.5))
    this.attempt++
    this.log.warn(`mất cloud, nối lại sau ${delay}ms (lần ${this.attempt})`)
    this.retryTimer = setTimeout(() => this.connect(), delay)
  }
}
