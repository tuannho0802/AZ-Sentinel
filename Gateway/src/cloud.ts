import {
  DEVICE_HEADER,
  GW,
  gwServerMessageSchema,
  isApiErrorBody,
  type TunnelDirectoryReply,
} from '@az-sentinel/shared'
import { cloudCheckUrl } from './check-token'
import type { Gateway } from './gateway'
import { type Logger, silentLogger } from './log'
import { isTrustedLearnedUrl, sanitizeForLog } from './url-policy'

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
  /** Mã thiết bị (whitelist thiết bị), gửi bằng header `X-AZ-Device` ở mọi lần nối/hỏi danh bạ. */
  deviceId?: string
  /**
   * Plan 3H: các địa chỉ HTTP của "danh bạ tunnel" (Worker, `/api/gw/tunnel`), thử lần lượt. Có thì Gateway hỏi
   * danh bạ khi khởi động, khi mất kết nối và khi đang dùng dự phòng, rồi nối THẲNG vào Quick Tunnel hiện tại của
   * VPS (không qua Worker nên không tốn hạn mức request). Không có = như cũ (địa chỉ cố định).
   */
  directoryUrls?: string[]
  /** Chỉ để kiểm thử: thay `fetch` gọi danh bạ. */
  fetchFn?: typeof fetch
  /** Chỉ để kiểm thử: thay `fetch` dùng cho bước chẩn đoán lý do nối thất bại. */
  probeFetchFn?: typeof fetch
  log?: Logger
  /** Chỉ để kiểm thử: nhân bản bộ ngẫu nhiên cho jitter. */
  random?: () => number
  /** Chỉ để kiểm thử: rút ngắn khoảng ping và hạn im lặng (ms). */
  pingMs?: number
  silentMs?: number
  /** Chỉ để kiểm thử: thu nhỏ backoff nối lại (mặc định `GW.reconnectMinSec`/`GW.reconnectMaxSec`) và khoảng cách hỏi danh bạ. */
  reconnectMinSec?: number
  reconnectMaxSec?: number
  directoryMinGapMs?: number
}

/** Mỗi địa chỉ chỉ chẩn đoán lý do nối thất bại tối đa chừng này ms một lần (không tốn request Worker khi VPS sập lâu). */
const EXPLAIN_EVERY_MS = 5 * 60_000

/**
 * Khi một kết nối CHƯA TỪNG mở được (opened = false) thì hỏi danh bạ tunnel (`GET /api/gw/tunnel`, tốn 1 request Worker)
 * tối đa chừng này ms một lần. Rớt sau khi đã nối được (VPS vừa reset) vẫn hỏi ngay để bắt tunnel mới sớm.
 */
const DIRECTORY_MIN_GAP_MS = 20_000

/** Nhịp thử quay về địa chỉ chính khi đang dùng dự phòng: 8 lần đầu (khoảng 2 phút) dày, sau đó thưa. */
const PROBE_FAST_MS = 15_000
const PROBE_FAST_TICKS = 8
const PROBE_SLOW_MS = 90_000

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
  /** Lần hỏi danh bạ gần nhất (ms), để giãn nhịp khi nối hỏng liên tục. */
  private lastAskAt = 0
  /**
   * Số vòng "chính hỏng, dự phòng cũng hỏng" liên tiếp. Vòng đầu (VPS vừa sập, dự phòng còn sống) vẫn chuyển
   * dự phòng ngay; từ vòng thứ hai trở đi `attempt` không bị đặt lại nên backoff tăng dần tới mức tối đa.
   */
  private deadCycles = 0
  /** Lần chẩn đoán gần nhất theo địa chỉ kiểm tra (để giãn nhịp). */
  private readonly lastExplained = new Map<string, number>()
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

  /**
   * Địa chỉ dự phòng: cấu hình riêng nếu có. Không có (Quick Tunnel: mã kết nối chỉ mang địa chỉ Worker, vì dự phòng
   * trùng chính nên bị bỏ) mà đã học được tunnel từ danh bạ thì chính Worker `opts.url` là dự phòng, nếu không Gateway
   * sẽ kẹt nối lại tunnel đã chết (danh bạ còn trỏ địa chỉ cũ tới khi VPS báo tunnel mới) và dữ liệu không vào được hub.
   */
  private fallbackTarget(): string | null {
    if (this.opts.fallbackUrl) return this.opts.fallbackUrl
    return this.learned !== null ? this.opts.url : null
  }

  /** Địa chỉ đang dùng (chính hoặc dự phòng). */
  private currentUrl(): string {
    return (this.urlIndex === 1 ? this.fallbackTarget() : null) ?? this.primaryUrl()
  }

  /** Các địa chỉ máy chủ đã cấu hình (chính, dự phòng): địa chỉ học từ danh bạ được phép trùng máy chủ với chúng. */
  private knownUrls(): string[] {
    return [this.opts.url, this.opts.fallbackUrl ?? ''].filter((u) => u !== '')
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
    this.lastAskAt = Date.now()
    const run = async (): Promise<boolean> => {
      const doFetch = this.opts.fetchFn ?? fetch
      const headers = this.requestHeaders()
      for (const url of this.directories()) {
        try {
          const res = await doFetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
          if (!res.ok) {
            await res.body?.cancel()
            continue
          }
          const body = (await res.json()) as Partial<TunnelDirectoryReply>
          if (body.ok !== true) continue
          // Chỉ nhận wss:// (ws:// chỉ cho loopback khi thử nghiệm) VÀ chỉ tới Quick Tunnel hoặc máy chủ đã cấu hình:
          // Gateway gửi token tới địa chỉ này, nên danh bạ (Worker) bị chiếm cũng không dẫn được token tới máy chủ lạ.
          const next =
            typeof body.wsUrl === 'string' &&
            /^wss?:\/\/[^\s"\\]+$/i.test(body.wsUrl) &&
            isTrustedLearnedUrl(body.wsUrl, this.knownUrls())
              ? body.wsUrl
              : null
          if (next === null && body.wsUrl) {
            this.log.warn(
              `bỏ qua địa chỉ tunnel không đáng tin từ danh bạ: ${sanitizeForLog(String(body.wsUrl), 80)}`,
            )
          }
          if (next === this.learned) return false
          this.deadCycles = 0
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

  /** Header danh tính của Gateway: token cá nhân và mã thiết bị (nếu có). */
  private requestHeaders(): Record<string, string> {
    const headers: Record<string, string> = {}
    if (this.opts.token) headers.Authorization = `Bearer ${this.opts.token}`
    if (this.opts.deviceId) headers[DEVICE_HEADER] = this.opts.deviceId
    return headers
  }

  /** Mở một WebSocket tới `url` kèm token (WebSocket toàn cục của Node/undici nhận `headers`). */
  private open(url: string): WebSocket {
    const headers = this.requestHeaders()
    const init = Object.keys(headers).length > 0 ? { headers } : undefined
    return init
      ? new (WebSocket as unknown as new (url: string, init: object) => WebSocket)(url, init)
      : new WebSocket(url)
  }

  private connect(): void {
    if (this.stopped) return
    let ws: WebSocket
    let opened = false
    const target = this.currentUrl()
    try {
      ws = this.open(target)
    } catch (e) {
      this.log.error(`URL cloud không hợp lệ: ${e instanceof Error ? e.message : String(e)}`)
      return
    }
    this.ws = ws

    ws.addEventListener('open', () => {
      opened = true
      this.attempt = 0
      this.deadCycles = 0
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
        this.log.warn(
          'không nối được cloud (sai địa chỉ, mạng, token bị từ chối/thu hồi, hoặc bị Whitelist IP/thiết bị chặn)',
        )
        this.explainFailure(target)
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

  /**
   * WebSocket thất bại không cho biết mã HTTP, nên hỏi lại bằng một request `GET /api/gw/check` với cùng token và mã
   * thiết bị rồi ghi lý do thật vào log (token sai, IP/thiết bị bị chặn, tunnel chết, quá số kết nối). Giãn nhịp theo
   * địa chỉ, và không bao giờ ghi token vào log.
   */
  private explainFailure(target: string): void {
    const url = cloudCheckUrl(target)
    if (!url) return
    const now = Date.now()
    if (now - (this.lastExplained.get(url) ?? 0) < EXPLAIN_EVERY_MS) return
    this.lastExplained.set(url, now)
    void this.diagnose(url)
  }

  private async diagnose(url: string): Promise<void> {
    let reason: string
    try {
      const res = await (this.opts.probeFetchFn ?? fetch)(url, {
        headers: this.requestHeaders(),
        signal: AbortSignal.timeout(8000),
      })
      let detail = ''
      if (res.ok) {
        await res.body?.cancel()
      } else {
        try {
          const body: unknown = await res.json()
          if (isApiErrorBody(body)) detail = sanitizeForLog(body.error.message)
        } catch {
          // thân phản hồi không phải JSON (trang lỗi của tunnel/proxy): chỉ báo mã
        }
      }
      reason = describeStatus(res.status, detail)
    } catch {
      reason = 'không tới được máy chủ qua HTTP (mạng, DNS hoặc tường lửa chặn)'
    }
    if (this.stopped) return
    let host = url
    try {
      host = new URL(url).host
    } catch {
      // giữ nguyên chuỗi
    }
    this.log.warn(`chẩn đoán ${host}: ${reason}`)
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
   * đóng sau vài giây. Nhịp thử: 15 giây trong 2 phút đầu (VPS reset thường lên lại nhanh), sau đó 90 giây để
   * không tốn request khi VPS sập lâu. `primaryRetryMs` (nếu đặt) cố định nhịp.
   */
  private startProbingPrimary(): void {
    if (this.probing || !this.fallbackTarget()) return
    this.probing = true
    this.probeTicks = 0
    const next = () => {
      const fixed = this.opts.primaryRetryMs
      const delay = fixed ?? (this.probeTicks < PROBE_FAST_TICKS ? PROBE_FAST_MS : PROBE_SLOW_MS)
      this.probeTimer = setTimeout(() => void tick(), delay)
      this.probeTimer.unref?.()
    }
    const tick = async () => {
      this.probeTimer = null
      if (this.stopped || this.urlIndex !== 1) return
      this.probeTicks++
      await this.askDirectory()
      if (this.stopped || this.urlIndex !== 1) return
      if (!this.fallbackTarget()) {
        // Danh bạ báo "không có tunnel": địa chỉ chính giờ chính là Worker đang nối, không còn gì để quay về.
        this.urlIndex = 0
        this.stopProbing()
        return
      }
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
    this.deadCycles = 0
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
    // Chưa từng nối được mà vừa hỏi xong thì bỏ qua lần hỏi này: tránh vòng lặp 1 request Worker mỗi lần thử lại.
    const gap = this.opts.directoryMinGapMs ?? DIRECTORY_MIN_GAP_MS
    const mayAsk = opened || Date.now() - this.lastAskAt >= gap
    if (!wasSwitching && this.urlIndex === 0 && this.directories().length > 0 && mayAsk) {
      void this.askDirectory().then((changed) => {
        if (this.stopped || this.ws) return
        if (changed) {
          this.failStreak = 0
          this.attempt = 0
          this.deadCycles = 0
          this.connect()
        } else this.scheduleReconnect()
      })
      return
    }
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    if (this.stopped) return
    if (this.fallbackTarget() && this.urlIndex === 0 && this.failStreak >= 2) {
      this.log.warn('địa chỉ chính không nối được, chuyển sang dự phòng')
      this.urlIndex = 1
      this.failStreak = 0
      // Lần chuyển dự phòng đầu tiên thì nối nhanh; đã hỏng cả hai vòng rồi thì giữ nguyên backoff đang tăng.
      if (this.deadCycles === 0) this.attempt = 0
    } else if (this.urlIndex === 1 && this.failStreak >= 2) {
      // Dự phòng cũng hỏng: thử lại địa chỉ chính (VPS có thể đã sống lại).
      this.urlIndex = 0
      this.failStreak = 0
      this.deadCycles++
      this.stopProbing()
    }
    const base = Math.min(
      this.opts.reconnectMaxSec ?? GW.reconnectMaxSec,
      (this.opts.reconnectMinSec ?? GW.reconnectMinSec) * 2 ** this.attempt,
    )
    const delay = Math.round(base * 1000 * (0.5 + this.rand() * 0.5))
    this.attempt++
    this.log.warn(`mất cloud, nối lại sau ${delay}ms (lần ${this.attempt})`)
    this.retryTimer = setTimeout(() => this.connect(), delay)
  }
}

/** Diễn giải mã HTTP của `/api/gw/check` thành lý do dễ hiểu cho người vận hành. */
export function describeStatus(status: number, detail: string): string {
  if (status === 200)
    return 'HTTP vào được và token hợp lệ nhưng WebSocket lỗi: kiểm tra tường lửa/proxy có chặn WebSocket không'
  if (status === 401)
    return 'token bị từ chối (sai, đã thu hồi hoặc đã đặt lại): xin quản trị viên token mới'
  if (status === 403)
    return `máy chủ chặn Gateway${detail ? `: ${detail}` : ' (Whitelist IP hoặc thiết bị chưa được duyệt)'}`
  if (status === 429) return detail || 'IP này đã đủ số kết nối tối đa'
  if ([502, 503, 504, 521, 522, 523, 524, 530].includes(status))
    return `tunnel hoặc máy chủ không phản hồi (HTTP ${status})`
  return `máy chủ trả HTTP ${status}${detail ? `: ${detail}` : ''}`
}
