import { GW, gwServerMessageSchema, type TunnelDirectoryReply } from '@az-sentinel/shared'
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
  /** Token Gateway cá nhân `azt_...` (quản trị viên cấp riêng cho từng người), gửi bằng `Authorization: Bearer`. */
  token?: string
  /**
   * Plan 3H: các địa chỉ HTTP của "danh bạ tunnel" (Worker, `/api/gw/tunnel`), thử lần lượt. Có thì Gateway hỏi
   * danh bạ khi khởi động, khi mất kết nối và khi đang dùng dự phòng, rồi nối THẲNG vào Quick Tunnel hiện tại của
   * VPS (không qua Worker nên không tốn hạn mức request). Không có = như cũ (địa chỉ cố định).
   */
  directoryUrls?: string[]
  /** Chỉ để kiểm thử: thay `fetch` gọi danh bạ. */
  fetchFn?: typeof fetch
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
  /** Địa chỉ WebSocket tunnel học từ danh bạ; ưu tiên hơn `opts.url` (null = dùng `opts.url`). */
  private learned: string | null = null
  private probeTicks = 0
  private probing = false
  private asking: Promise<boolean> | null = null
  /** Đang chủ động đổi địa chỉ (không cần hỏi danh bạ ở lần đóng kế). */
  private switching = false
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
    // Biết địa chỉ tunnel mới nhất trước khi nối (tối đa 5 giây), để khởi động xong là nối thẳng được.
    if (this.directories().length === 0) {
      this.connect()
      return
    }
    void this.askDirectory(5000).finally(() => this.connect())
  }

  stop(): void {
    this.stopped = true
    if (this.retryTimer) clearTimeout(this.retryTimer)
    if (this.pingTimer) clearInterval(this.pingTimer)
    if (this.probeTimer) clearTimeout(this.probeTimer)
    this.retryTimer = this.pingTimer = this.probeTimer = null
    this.probing = false
    const ws = this.ws
    this.ws = null
    if (ws) {
      this.gw.onCloudClose()
      ws.close(1000, 'gateway stopping')
    }
  }

  /** Địa chỉ chính hiện tại: tunnel học từ danh bạ nếu có, không thì địa chỉ cấu hình. */
  private primaryUrl(): string {
    return this.learned ?? this.opts.url
  }

  /** Địa chỉ đang dùng (chính hoặc dự phòng). */
  private currentUrl(): string {
    return this.urlIndex === 1 && this.opts.fallbackUrl ? this.opts.fallbackUrl : this.primaryUrl()
  }

  private directories(): string[] {
    return [...new Set(this.opts.directoryUrls ?? [])]
  }

  /**
   * Hỏi danh bạ tunnel; trả true khi địa chỉ chính ĐỔI. Lỗi mạng/Worker sập thì bỏ qua (trả false). Không chạy
   * hai lần cùng lúc.
   */
  private askDirectory(timeoutMs = 8000): Promise<boolean> {
    if (this.directories().length === 0) return Promise.resolve(false)
    if (this.asking) return this.asking
    const run = async (): Promise<boolean> => {
      const doFetch = this.opts.fetchFn ?? fetch
      const headers: Record<string, string> = this.opts.token
        ? { Authorization: `Bearer ${this.opts.token}` }
        : {}
      for (const url of this.directories()) {
        try {
          const res = await doFetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
          if (!res.ok) {
            await res.body?.cancel()
            continue
          }
          const body = (await res.json()) as Partial<TunnelDirectoryReply>
          if (body.ok !== true) continue
          // Chỉ nhận wss:// (ws:// chỉ cho loopback khi thử nghiệm): danh bạ không được hạ Gateway xuống đường không mã hóa.
          const next =
            typeof body.wsUrl === 'string' &&
            /^(wss:\/\/|ws:\/\/(127\.0\.0\.1|localhost)[:/])[^\s"\\]+$/i.test(body.wsUrl)
              ? body.wsUrl
              : null
          if (next === this.learned) return false
          this.learned = next
          this.log.info(
            next
              ? `danh bạ báo tunnel mới: ${next}`
              : 'danh bạ không có tunnel, dùng địa chỉ cấu hình',
          )
          return true
        } catch {
          // thử địa chỉ danh bạ kế tiếp
        }
      }
      return false
    }
    this.asking = run().finally(() => {
      this.asking = null
    })
    return this.asking
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

    // Kết nối THẤT BẠI (cổng đóng, tunnel chết trả HTTP 530...) có runtime chỉ bắn `error` mà không bắn `close`
    // (Node 22 thấy ở đây): nếu chờ `close` thì Gateway treo vĩnh viễn. Nên lỗi lúc chưa mở cũng tính là kết thúc;
    // `ended` bảo đảm mỗi kết nối chỉ xử lý một lần dù cả hai sự kiện cùng tới.
    let ended = false
    const end = (code?: number) => {
      if (ended) return
      ended = true
      if (code === 4003) {
        this.log.warn(
          'token Gateway đã bị thu hồi hoặc đặt lại: xin quản trị viên token mới rồi nhập vào Cài đặt',
        )
      } else if (!opened) {
        this.log.warn('không nối được cloud (sai địa chỉ, mạng, hoặc token bị từ chối/thu hồi)')
      }
      this.onClosed(ws, opened)
    }
    ws.addEventListener('close', (ev) => end(ev.code))
    ws.addEventListener('error', () => {
      if (opened || ended) return // đã mở: `close` luôn theo sau
      end() // đặt `ended` trước: `ws.close()` lúc đang nối có thể bắn lại `error`
      try {
        ws.close()
      } catch {
        // đã đóng
      }
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
   * Trong lúc dùng dự phòng: hỏi danh bạ (nếu có) để biết tunnel mới, rồi thử mở địa chỉ chính; mở được thì đóng
   * thử và đóng kết nối dự phòng để `onClosed` nối lại vào địa chỉ chính. Kết nối thử không gửi `hello` nên hub tự
   * đóng sau vài giây. Nhịp thử: 15 giây trong 2 phút đầu (VPS reset thường lên lại nhanh), sau đó 60 giây để
   * không tốn request khi VPS sập lâu. `primaryRetryMs` (nếu đặt) cố định nhịp.
   */
  private startProbingPrimary(): void {
    if (this.probing || !this.opts.fallbackUrl) return
    this.probing = true
    this.probeTicks = 0
    const next = () => {
      const fixed = this.opts.primaryRetryMs
      const delay = fixed ?? (this.probeTicks < 8 ? 15_000 : 60_000)
      this.probeTimer = setTimeout(() => void tick(), delay)
      this.probeTimer.unref?.()
    }
    const tick = async () => {
      this.probeTimer = null
      if (this.stopped || this.urlIndex !== 1) return
      this.probeTicks++
      await this.askDirectory()
      if (this.stopped || this.urlIndex !== 1) return
      let probe: WebSocket
      try {
        probe = this.open(this.primaryUrl())
      } catch {
        return next()
      }
      let done = false
      const finish = (ok: boolean) => {
        if (done) return
        done = true
        clearTimeout(giveUp)
        try {
          probe.close(ok ? 1000 : undefined, ok ? 'probe' : undefined)
        } catch {
          // đã đóng
        }
        if (ok) {
          this.log.info('địa chỉ chính đã sống lại, chuyển về')
          this.switchTo(0)
        } else if (!this.stopped && this.urlIndex === 1 && !this.probeTimer) next()
      }
      const giveUp = setTimeout(() => finish(false), 8000)
      probe.addEventListener('open', () => finish(true))
      probe.addEventListener('error', () => finish(false))
      probe.addEventListener('close', () => finish(false))
    }
    next()
  }

  private stopProbing(): void {
    this.probing = false
    if (this.probeTimer) clearTimeout(this.probeTimer)
    this.probeTimer = null
  }

  /** Đổi địa chỉ rồi đóng kết nối hiện tại; `onClosed` sẽ nối lại vào địa chỉ mới. */
  private switchTo(index: 0 | 1): void {
    this.urlIndex = index
    this.failStreak = 0
    this.attempt = 0
    this.switching = true
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
    const wasSwitching = this.switching
    this.switching = false
    // Mất kết nối vào địa chỉ chính: hỏi danh bạ ngay (VPS có thể vừa reset và đổi tunnel). Có tunnel mới thì
    // nối lại liền, không chờ backoff và không phải rơi xuống dự phòng.
    if (!wasSwitching && this.urlIndex === 0 && this.directories().length > 0) {
      void this.askDirectory().then((changed) => {
        if (this.stopped || this.ws) return
        if (changed) {
          this.failStreak = 0
          this.attempt = 0
          this.connect()
        } else this.scheduleReconnect()
      })
      return
    }
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    if (this.stopped) return
    if (this.opts.fallbackUrl && this.urlIndex === 0 && this.failStreak >= 2) {
      this.log.warn('địa chỉ chính không nối được, chuyển sang dự phòng')
      this.urlIndex = 1
      this.failStreak = 0
      this.attempt = 0
    } else if (this.urlIndex === 1 && this.failStreak >= 2) {
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
