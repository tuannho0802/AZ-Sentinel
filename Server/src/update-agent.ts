import {
  GATEWAY_EXE_ASSET,
  type GatewayOffer,
  gatewayAssetUrl,
  latestGatewayRelease,
  latestRelease,
  parseSha256Sums,
  RELEASES_API_URL,
  sha256SumsUrl,
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
  /**
   * Bật việc ép Gateway cập nhật: ngoài banner, Server còn tìm bản Gateway mới (kèm băm SHA-256 từ `SHA256SUMS.txt`)
   * để hub gửi tin `update` cho các Gateway cũ hơn. Tắt bằng `AZ_GATEWAY_AUTO_UPDATE=0`.
   */
  gatewayPush?: boolean
  /** Gọi khi tìm được bản Gateway mới (lần đầu hoặc đổi phiên bản): để hub ép các Gateway đang nối cập nhật ngay. */
  onGatewayOffer?: (offer: GatewayOffer) => void
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
  /** Bản Gateway mới nhất (đủ exe và file băm) trong danh sách release gần nhất; null = chưa có release nào dùng được. */
  private gatewayLatest: string | null = null
  private offer: GatewayOffer | null = null
  private offerFailure: string | null = null
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

  /** Bản Gateway mà hub nên ép các Gateway cũ hơn cập nhật tới; null khi chưa có hoặc đã tắt. */
  gatewayOffer(): GatewayOffer | null {
    return this.opts.gatewayPush ? this.offer : null
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
      // Danh sách không đổi, nhưng lần lấy băm trước có thể đã lỗi: thử lại.
      const retry = await this.refreshGatewayOffer()
      return retry ? this.retrySec : this.checkSec
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
    this.gatewayLatest = this.opts.gatewayPush ? latestGatewayRelease(list) : null
    // Release Gateway bị xóa (hoặc không còn bản nào đủ file): thôi ép, đừng giữ địa chỉ tải đã chết.
    if (this.gatewayLatest === null) {
      this.offer = null
      this.offerFailure = null
    }
    const retry = await this.refreshGatewayOffer()
    return retry ? this.retrySec : this.checkSec
  }

  /**
   * Lấy băm SHA-256 của exe Gateway từ `SHA256SUMS.txt` của release mới nhất rồi lưu thành `offer`. Chỉ tải khi phiên bản
   * mới hơn bản đang giữ (mỗi phiên bản một lần). Trả true nếu lỗi và nên thử lại sớm. Mọi lỗi chỉ ghi log.
   */
  private async refreshGatewayOffer(): Promise<boolean> {
    const version = this.gatewayLatest
    if (!this.opts.gatewayPush || version === null || this.offer?.version === version) return false
    try {
      const res = await this.fetchFn(sha256SumsUrl(version), {
        headers: { 'user-agent': `az-server/${this.opts.current}` },
        redirect: 'follow',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (!res.ok) {
        await res.body?.cancel()
        throw new Error(`GitHub trả HTTP ${res.status} khi lấy SHA256SUMS.txt`)
      }
      // File băm chỉ vài dòng; cắt để dữ liệu lạ không ăn bộ nhớ.
      const text = (await res.text()).slice(0, 8192)
      const sha256 = parseSha256Sums(text, GATEWAY_EXE_ASSET)
      if (!sha256)
        throw new Error(`SHA256SUMS.txt của gateway-v${version} không có dòng ${GATEWAY_EXE_ASSET}`)
      this.offer = { version, url: gatewayAssetUrl(version), sha256 }
      this.offerFailure = null
      this.opts.log.info(`sẽ ép Gateway cũ hơn cập nhật lên v${version}`)
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 160)
      if (this.offerFailure !== msg) {
        this.offerFailure = msg
        this.opts.log.warn(`không lấy được băm bản Gateway v${version}: ${msg}`)
      }
      return true
    }
    // Ngoài khối try: hub lỗi không được bị báo nhầm thành "không lấy được băm" và không làm Server thử lại băm.
    try {
      if (this.offer) this.opts.onGatewayOffer?.(this.offer)
    } catch (e) {
      this.opts.log.warn(`báo hub về bản Gateway v${version} lỗi: ${String(e).slice(0, 160)}`)
    }
    return false
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
