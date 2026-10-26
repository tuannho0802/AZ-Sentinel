import {
  latestRelease,
  RELEASES_API_URL,
  UPDATE_CHECK_SEC,
  UPDATE_RETRY_SEC,
  type UpdateStatus,
} from '@az-sentinel/shared'
import type { Logger } from './log'

export type UpdateAgentOptions = {
  /** Phiên bản Server đang chạy (`x.y.z`). */
  current: string
  log: Logger
  fetchFn?: typeof fetch
  /** Chu kỳ kiểm tra (giây) khi bình thường / khi lỗi mạng. */
  checkSec?: number
  retrySec?: number
  nowMs?: () => number
}

const REQUEST_TIMEOUT_MS = 10_000

/**
 * Hỏi GitHub Releases xem có bản Server mới không (`server-v*`) và nhớ kết quả để `GET /api/server-info` trả cho giao
 * diện hiện banner. Chạy ngay khi khởi động rồi lặp lại mỗi `checkSec` (mặc định 5 phút); có ETag nên lần không đổi chỉ là 304 (không
 * tốn hạn mức GitHub). Server không tự tải hay tự thay file: quản trị viên chạy bộ cài mới. Mọi lỗi (mất mạng, GitHub
 * hạn mức, dữ liệu lạ) chỉ ghi log và thử lại, không ảnh hưởng việc phục vụ.
 */
export class UpdateAgent {
  private state: UpdateStatus = { server: null, checkedAt: null }
  private etag: string | null = null
  private timer: NodeJS.Timeout | null = null
  private stopped = false
  private lastFailure: string | null = null
  private lastAnnounced: string | null = null
  private readonly checkSec: number
  private readonly retrySec: number
  private readonly fetchFn: typeof fetch
  private readonly nowMs: () => number

  constructor(private readonly opts: UpdateAgentOptions) {
    this.checkSec = opts.checkSec ?? UPDATE_CHECK_SEC
    this.retrySec = opts.retrySec ?? UPDATE_RETRY_SEC
    this.fetchFn = opts.fetchFn ?? fetch
    this.nowMs = opts.nowMs ?? Date.now
  }

  start(): void {
    this.stopped = false
    void this.tick()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  /** Kết quả gần nhất (đưa vào `server-info`). */
  status(): UpdateStatus {
    return this.state
  }

  /** Một vòng kiểm tra rồi hẹn vòng sau. Công khai để kiểm thử. */
  async tick(): Promise<void> {
    if (this.stopped) return
    let delaySec = this.retrySec
    try {
      delaySec = await this.check()
    } catch (e) {
      this.noteFailure(e instanceof Error ? e.message : String(e))
    }
    if (this.stopped) return
    this.timer = setTimeout(() => void this.tick(), delaySec * 1000)
    this.timer.unref()
  }

  /** Trả số giây chờ trước lần kiểm tra kế tiếp. */
  private async check(): Promise<number> {
    const headers: Record<string, string> = {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': `az-server/${this.opts.current}`,
    }
    if (this.etag) headers['if-none-match'] = this.etag
    const res = await this.fetchFn(RELEASES_API_URL, {
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    if (res.status === 304) {
      await res.body?.cancel()
      this.state = { ...this.state, checkedAt: this.nowSec() }
      this.noteRecovered()
      return this.checkSec
    }
    if (!res.ok) {
      await res.body?.cancel()
      this.noteFailure(`GitHub trả HTTP ${res.status}`)
      // Hết hạn mức (403/429): thử dày hơn cũng vô ích, chờ đủ một chu kỳ.
      return res.status === 403 || res.status === 429 ? this.checkSec : this.retrySec
    }

    const list: unknown = await res.json()
    this.etag = res.headers.get('etag')
    const server = latestRelease(list, 'server', this.opts.current)
    this.state = { server, checkedAt: this.nowSec() }
    this.noteRecovered()
    if (server?.available && this.lastAnnounced !== server.latest) {
      this.lastAnnounced = server.latest
      this.opts.log.info(
        `có bản Server mới v${server.latest} (đang chạy v${this.opts.current}): ${server.url}`,
      )
    }
    return this.checkSec
  }

  private nowSec(): number {
    return Math.floor(this.nowMs() / 1000)
  }

  /** Lỗi lặp lại chỉ ghi một lần ở mức warn để log không bị ngập khi mất mạng kéo dài. */
  private noteFailure(msg: string): void {
    const short = msg.slice(0, 160)
    if (this.lastFailure === short) {
      this.opts.log.debug(`kiểm tra bản cập nhật vẫn lỗi: ${short}`)
      return
    }
    this.lastFailure = short
    this.opts.log.warn(`không kiểm tra được bản cập nhật Server: ${short}`)
  }

  private noteRecovered(): void {
    if (this.lastFailure === null) return
    this.lastFailure = null
    this.opts.log.info('đã kiểm tra lại được bản cập nhật Server')
  }
}
