import {
  type AlertRequest,
  type BindState,
  clampIntervalMs,
  clampPushSec,
  type EventRequest,
  GW,
  type GwClientMessage,
  type GwServerMessage,
  type LocalAlertResponse,
  type LocalEventResponse,
  type LocalPingResponse,
  type PingRequest,
  type Position,
  type PositionPl,
  type Sample,
  type SamplesRequest,
  type Snap,
  TRADE,
  type TradeResultRequest,
  terminalId,
} from '@az-sentinel/shared'
import { type Logger, silentLogger } from './log'
import { EventQueue } from './queue'

/** Bản build (CI gắn `GW_BUILD_VERSION` từ tag `gateway-vX.Y.Z`); chạy dev thì dùng mặc định. */
export const GATEWAY_VERSION = process.env.GW_BUILD_VERSION || '0.1.0'

/** Trần số mẫu giữ cho mỗi terminal giữa hai lần gom (push tối đa 5 giây, 1 mẫu/giây). */
const MAX_BUFFER = 60
/** Số terminal tối đa một Gateway nhận (hub tính cỡ ~30 EA): chặn tiến trình cục bộ tạo terminal vô hạn làm đầy bộ nhớ. */
export const MAX_TERMINALS = 64

export class TooManyTerminalsError extends Error {
  constructor() {
    super('too_many_terminals')
  }
}

/** Dung sai (ms) khi so nhịp đẩy: bộ hẹn giờ lệch vài ms không được làm lỡ một nhịp. */
const PUSH_SLACK_MS = 20

/** Mỗi terminal giữ tối đa chừng này báo cáo cảnh báo chưa được cloud xác nhận. */
const MAX_PENDING_ALERTS = 5

/** Báo cáo cảnh báo chưa có `alert_ack` được gửi lại sau chừng này ms (ngoài các mốc nối lại/bind). */
const ALERT_RESEND_MS = 30_000

type PendingAlert = { req: AlertRequest; sentMs: number }

/** Lệnh giao dịch thủ công đang chờ EA (v0.2.6). Mỗi terminal tối đa một. */
type PendingTrade = {
  cmd: Extract<GwServerMessage, { t: 'trade' }>
  /** Hạn dùng (ms): quá hạn EA không bắt đầu thực thi. */
  expiresMs: number
}

/** Gửi một tin lên cloud. Trả về false khi chưa có kết nối (tin bị bỏ, không xếp hàng ở đây). */
export type CloudSend = (msg: GwClientMessage) => boolean

type Terminal = {
  tid: string
  sid: string
  key: string
  login: number
  server: string
  mode: PingRequest['mode']
  broker?: string
  name?: string
  eaVer: string
  snap: Snap
  /** EA còn ping trong `offlineAfterSec`. */
  online: boolean
  /** Terminal đang nối được broker. */
  conn: boolean
  lastSeenMs: number
  bind: BindState
  code: number
  /** Đã gửi `bind` cho kết nối cloud hiện tại. */
  bindSent: boolean
  /** Trạng thái online cuối đã báo cloud, để không báo lặp. */
  pushedOnline: boolean | null
  /** `seq` EA cuối đã nhận, theo phiên `sid` (loại trùng cục bộ). */
  lastEaSeq: { samples: number; event: number }
  buffer: Sample[]
  positions?: Position[]
  posHash?: string
  posDirty: boolean
  /** Lãi/lỗ từng lệnh mới nhất chưa gửi (chỉ giữ cho terminal xem riêng). */
  pl?: PositionPl
  /** Lần cuối đã đẩy `batch` có terminal này (ms); 0 = chưa, nên nhịp đầu đi ngay. */
  lastPushMs: number
  /** Lần gửi hàng đợi cuối `seq` -> đã gửi lên cloud kết nối hiện tại. */
  inflight: Set<number>
  /** Mẫu và lãi/lỗ cuối đã đẩy lên cloud, và giờ đẩy (ms), để bỏ bản trùng hệt (có nhịp giữ sống). */
  lastSent?: Sample
  lastSentAtMs: number
  lastPlJson?: string
  /** Báo cáo cảnh báo lỗ float chưa được cloud xác nhận (theo `aseq`), gửi lại cho tới khi có `alert_ack`. */
  alerts: Map<number, PendingAlert>
  /** Lệnh giao dịch thủ công đang chờ kết quả của EA. */
  trade?: PendingTrade
  /** Kết quả EA báo chưa chắc đã tới cloud: giữ để gửi lại khi nối lại. */
  tradeResults: Map<string, TradeResultRequest>
}

/** Hai mẫu cùng giá trị (bỏ qua `t`): không có gì mới để cho người xem. */
function sameValues(a: Sample, b: Sample | undefined): boolean {
  return (
    b !== undefined &&
    a.eq === b.eq &&
    a.bal === b.bal &&
    a.fl === b.fl &&
    (a.ml ?? null) === (b.ml ?? null)
  )
}

export type TerminalStatus = {
  tid: string
  login: number
  server: string
  mode: string
  eaVer: string
  online: boolean
  conn: boolean
  bind: BindState
  code: number
  watching: boolean
  lastSeenSec: number
  queued: number
}

export type GatewayStatus = {
  version: string
  /** Nhãn VPS (hostname) gửi lên cloud. */
  vps: string
  cloud: { configured: boolean; connected: boolean }
  uptimeSec: number
  pushSec: number
  watched: number
  /** Số terminal đang được xem riêng (trang chi tiết): EA gửi và Gateway đẩy theo tick. */
  fast: number
  queued: number
  droppedEvents: number
  /** Ngưỡng cảnh báo lỗ float đang giữ (basis point, 0 = tắt). */
  alertBp: number
  terminals: TerminalStatus[]
}

export type GatewayOptions = {
  vps?: string
  queue?: EventQueue
  log?: Logger
  now?: () => number
  cloudConfigured?: boolean
  /** Ghi đè `GW.idleFlushSec` (0 = gửi `event` ngay cả khi không ai xem). */
  idleFlushSec?: number
}

/**
 * Lõi Gateway (Plan 3C mục 3, 4, 7). Không biết gì về HTTP hay WebSocket: `LocalServer` gọi
 * `handle*`, `CloudClient` gọi `onCloud*`. Nhờ vậy kiểm thử logic không cần mở socket.
 *
 * Nguyên tắc an toàn: lỗi luôn làm dữ liệu ngừng chảy. Mất cloud thì `watch` về rỗng, EA tự
 * về TRACK ở lần ping kế tiếp; sự kiện giao dịch được giữ lại để gửi bù.
 */
export class Gateway {
  private readonly terminals = new Map<string, Terminal>()
  private readonly queue: EventQueue
  private readonly log: Logger
  private readonly now: () => number
  private readonly startedMs: number
  private send: CloudSend | null = null
  private watch = new Set<string>()
  /** Tập con của `watch` đang được xem riêng: đẩy theo tick (`GW.fastPushMs`). */
  private fast = new Set<string>()
  private pushSec: number = GW.defaultPushSec
  /**
   * Ngưỡng cảnh báo lỗ float (basis point của Balance, 0 = tắt) do cloud đặt, chuyển cho EA qua `alert_bp`.
   * Mất cloud thì giữ giá trị cũ (EA vẫn đo theo ngưỡng cuối; Server mới là nơi quyết định có báo hay không).
   */
  private alertBp = 0
  private lastGseq = 0
  /** Lần cuối đẩy `state`/`event` đã giữ lại (ms). Khởi tạo = lúc khởi động: giữ ngay từ đầu. */
  private lastDeferredMs: number
  private flushTimer: NodeJS.Timeout | null = null
  private sweepTimer: NodeJS.Timeout | null = null

  constructor(private readonly opts: GatewayOptions = {}) {
    this.queue = opts.queue ?? new EventQueue()
    this.log = opts.log ?? silentLogger
    this.now = opts.now ?? Date.now
    this.startedMs = this.now()
    this.lastDeferredMs = this.startedMs
  }

  // -------------------------------------------------------------------------
  // Vòng đời
  // -------------------------------------------------------------------------

  /**
   * Bật hai bộ hẹn giờ: quét offline (1 giây) và gom `batch`. Bộ gom chạy ở nhịp nhanh nhất; mỗi
   * terminal tự giới hạn nhịp của mình trong `flush` (theo tick nếu xem riêng, `push_sec` nếu không).
   */
  start(): void {
    this.sweepTimer = setInterval(() => this.sweep(), 1000)
    this.sweepTimer.unref()
    this.flushTimer = setInterval(() => this.flush(), GW.fastPushMs)
    this.flushTimer.unref()
  }

  stop(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer)
    if (this.flushTimer) clearInterval(this.flushTimer)
    this.sweepTimer = null
    this.flushTimer = null
    this.queue.flush()
  }

  // -------------------------------------------------------------------------
  // EA -> Gateway
  // -------------------------------------------------------------------------

  /** Ném `TooManyTerminalsError` khi đã đủ `MAX_TERMINALS` terminal và đây là terminal mới (local server trả 429). */
  handlePing(req: PingRequest): LocalPingResponse {
    const now = this.now()
    const tid = terminalId(req.login, req.server)
    let t = this.terminals.get(tid)

    if (!t) {
      if (this.terminals.size >= MAX_TERMINALS) this.refuseNewTerminal(tid)
      t = this.createTerminal(tid, req, now)
      this.terminals.set(tid, t)
      this.log.info(`terminal mới ${tid} (${req.mode}, ea ${req.ea_ver || '?'})`)
    } else {
      this.refreshTerminal(t, req, now)
    }

    this.syncBind(t)
    this.syncState(t)
    return this.pingResponse(t)
  }

  private refuseNewTerminal(tid: string): never {
    this.log.warn(`từ chối terminal mới ${tid}: đã đủ ${MAX_TERMINALS} terminal`)
    throw new TooManyTerminalsError()
  }

  handleSamples(req: SamplesRequest): LocalPingResponse {
    const tid = terminalId(req.login, req.server)
    const t = this.terminals.get(tid)
    // Terminal lạ (Gateway vừa khởi động lại): trả "không xem", EA về TRACK và ping để đăng ký.
    if (!t || t.key !== req.key) return this.idleResponse()

    t.lastSeenMs = this.now()
    if (!this.isWatched(t)) return this.pingResponse(t)

    // Loại trùng khi EA gửi lại cùng lô sau lỗi mạng cục bộ.
    if (t.sid === req.sid && req.seq <= t.lastEaSeq.samples) return this.pingResponse(t)
    t.lastEaSeq.samples = req.seq

    t.buffer.push(...req.samples)
    if (t.buffer.length > MAX_BUFFER) t.buffer.splice(0, t.buffer.length - MAX_BUFFER)
    if (req.positions) {
      t.positions = req.positions
      t.posHash = req.pos_hash
      t.posDirty = true
      t.pl = undefined // danh sách đầy đủ đã gồm lãi/lỗ hiện tại
    } else if (req.pl && this.isFast(t)) {
      t.pl = req.pl
    }
    return this.pingResponse(t)
  }

  handleEvent(req: EventRequest): LocalEventResponse {
    const tid = terminalId(req.login, req.server)
    let t = this.terminals.get(tid)
    if (!t) {
      if (this.terminals.size >= MAX_TERMINALS) this.refuseNewTerminal(tid)
      // Sự kiện đến trước ping (Gateway mới khởi động): tạo terminal tạm từ định danh trong tin.
      t = this.createTerminal(
        tid,
        {
          v: 1,
          sid: req.sid,
          key: req.key,
          login: req.login,
          server: req.server,
          ea_ver: '',
          mode: 'real',
          conn: true,
          snap: req.snap ?? { bal: 0, eq: 0, fl: 0 },
        },
        this.now(),
      )
      this.terminals.set(tid, t)
      this.syncBind(t)
    }
    t.lastSeenMs = this.now()

    // Loại trùng theo (sid, seq): EA gửi lại lô đã nhận mà chưa kịp thấy ack.
    if (t.sid === req.sid && req.seq <= t.lastEaSeq.event) {
      return { ok: true, ack_seq: req.seq }
    }
    if (t.sid !== req.sid) {
      t.sid = req.sid
      t.lastEaSeq = { samples: 0, event: 0 }
    }
    t.lastEaSeq.event = req.seq

    if (t.bind === 'rejected') return { ok: true, ack_seq: req.seq }

    this.queue.push({
      tid,
      seq: this.nextGseq(),
      reason: req.reason,
      events: req.events,
      snap: req.snap,
    })
    this.drainQueue(t)
    return { ok: true, ack_seq: req.seq }
  }

  /**
   * EA báo vượt ngưỡng lỗ float hoặc hết lệnh. Gateway giữ báo cáo và gửi lên cloud tới khi có `alert_ack`;
   * `ack_aseq` trả EA chỉ nghĩa là Gateway đã giữ (EA có thể ngừng gửi lại `clear`). Terminal lạ trả null
   * (Gateway vừa khởi động lại: EA ping rồi gửi lại ở nhịp sau). Terminal bị từ chối thì nhận và bỏ.
   */
  handleAlert(req: AlertRequest): LocalAlertResponse | null {
    const tid = terminalId(req.login, req.server)
    const t = this.terminals.get(tid)
    if (!t || t.key !== req.key) return null
    t.lastSeenMs = this.now()
    if (t.bind === 'rejected') return { ok: true, ack_aseq: req.aseq }

    // `breach` mới thay mọi `breach` cũ chưa gửi xong (chỉ trạng thái mới nhất có ý nghĩa); `clear` luôn được giữ.
    if (req.kind === 'breach') {
      for (const [aseq, p] of t.alerts)
        if (p.req.kind === 'breach' && aseq < req.aseq) t.alerts.delete(aseq)
    }
    if (!t.alerts.has(req.aseq)) t.alerts.set(req.aseq, { req, sentMs: 0 })
    while (t.alerts.size > MAX_PENDING_ALERTS) {
      const oldest = t.alerts.keys().next().value
      if (oldest === undefined) break
      t.alerts.delete(oldest)
    }
    this.sendAlerts(t)
    return { ok: true, ack_aseq: req.aseq }
  }

  /**
   * EA báo kết quả lệnh giao dịch thủ công. Gateway chuyển lên cloud rồi xóa lệnh đang chờ. Kết quả của
   * lệnh khác với lệnh đang chờ (đến muộn sau `timeout`, hoặc lệnh đã bị bỏ) vẫn được chuyển tiếp: đó là sự
   * thật về những gì sàn đã làm. Terminal lạ trả null (Gateway vừa khởi động lại: EA gửi lại ở nhịp sau).
   */
  handleTradeResult(req: TradeResultRequest): { ok: true } | null {
    const tid = terminalId(req.login, req.server)
    const t = this.terminals.get(tid)
    if (!t || t.key !== req.key) return null
    t.lastSeenMs = this.now()
    if (t.trade?.cmd.cmd_id === req.cmd_id) t.trade = undefined
    if (t.bind === 'rejected') return { ok: true }
    t.tradeResults.set(req.cmd_id, req)
    while (t.tradeResults.size > 5) {
      const oldest = t.tradeResults.keys().next().value
      if (oldest === undefined) break
      t.tradeResults.delete(oldest)
    }
    this.sendTradeResults(t)
    return { ok: true }
  }

  // -------------------------------------------------------------------------
  // Cloud -> Gateway
  // -------------------------------------------------------------------------

  onCloudOpen(send: CloudSend): void {
    this.send = send
    this.watch.clear()
    this.fast.clear()
    send({
      t: 'hello',
      v: 1,
      gw_ver: GATEWAY_VERSION,
      vps: this.opts.vps,
      os: process.platform,
    })
    for (const t of this.terminals.values()) {
      t.bindSent = false
      t.pushedOnline = null
      t.inflight.clear()
      for (const p of t.alerts.values()) p.sentMs = 0
      if (t.bind !== 'rejected') t.bind = 'pending'
      this.syncBind(t)
    }
    this.log.info(`cloud đã nối, ${this.terminals.size} terminal đang chờ bind`)
  }

  /** Mất cloud: ngừng mọi live ngay (an toàn khi lỗi). Sự kiện vẫn ở hàng đợi. */
  onCloudClose(): void {
    this.send = null
    this.watch.clear()
    this.fast.clear()
    for (const t of this.terminals.values()) {
      t.buffer = []
      t.pl = undefined
      // Lệnh giao dịch chưa tới EA thì hủy: người dùng không còn thấy kết quả, không được tự chạy ngầm.
      // Lệnh EA đã nhận thì kết quả vẫn được giữ (`tradeResults`) và gửi lại khi nối lại.
      t.trade = undefined
    }
    this.log.warn('cloud đã ngắt, ngừng live, giữ hàng đợi sự kiện')
  }

  onCloudMessage(msg: GwServerMessage): void {
    switch (msg.t) {
      case 'bound': {
        const t = this.terminals.get(msg.tid)
        if (!t) return
        t.bind = 'ok'
        t.code = 0
        this.log.info(`bind ok ${msg.tid} -> liên kết ${msg.link_id}`)
        this.syncState(t)
        this.drainQueue(t)
        this.sendAlerts(t)
        this.sendTradeResults(t)
        return
      }
      case 'alert_cfg':
        this.alertBp = msg.loss_bp
        this.log.info(`ngưỡng cảnh báo lỗ float: ${msg.loss_bp} bp`)
        return
      case 'alert_ack':
        this.terminals.get(msg.tid)?.alerts.delete(msg.aseq)
        return
      case 'reject': {
        const t = this.terminals.get(msg.tid)
        if (!t) return
        t.bind = 'rejected'
        t.code = msg.code
        t.buffer = []
        this.watch.delete(msg.tid)
        this.fast.delete(msg.tid)
        t.alerts.clear()
        t.trade = undefined
        t.tradeResults.clear()
        const dropped = this.queue.dropTerminal(msg.tid)
        this.log.warn(`bind bị từ chối ${msg.tid} mã ${msg.code}, bỏ ${dropped} lô sự kiện`)
        return
      }
      case 'watch': {
        // Lưu nguyên tập cloud yêu cầu: `watch` có thể đến trước `bound`; `isWatched` mới kiểm bind.
        const next = new Set(msg.tids)
        // `fast` chỉ có nghĩa với terminal đang được watch.
        const nextFast = new Set((msg.fast ?? []).filter((tid) => next.has(tid)))
        for (const tid of this.watch) {
          if (!next.has(tid)) {
            const t = this.terminals.get(tid)
            if (t) {
              t.buffer = []
              t.pl = undefined
              t.lastPushMs = 0
              t.lastSent = undefined
              t.lastSentAtMs = 0
              t.lastPlJson = undefined
            }
          }
        }
        for (const tid of this.fast) {
          // Rời chế độ theo tick: bỏ lãi/lỗ đang giữ (danh sách chỉ cần tổng).
          if (!nextFast.has(tid)) {
            const t = this.terminals.get(tid)
            if (t) t.pl = undefined
          }
        }
        this.watch = next
        this.fast = nextFast
        this.pushSec = clampPushSec(msg.push_sec)
        // Có người bắt đầu xem: đẩy ngay `event` đã giữ để lịch sử lệnh hiện đúng.
        if (next.size > 0) this.flushDeferred()
        this.log.debug(
          `watch ${next.size} terminal (${nextFast.size} theo tick), push ${this.pushSec}s`,
        )
        return
      }
      case 'ack': {
        const t = this.terminals.get(msg.tid)
        t?.inflight.delete(msg.seq)
        this.queue.ack(msg.tid, msg.seq)
        return
      }
      case 'trade':
        this.acceptTrade(msg)
        return
      case 'update':
        // Tự cập nhật thuộc patch 12 (bộ cài). Ghi nhận để không âm thầm bỏ qua.
        this.log.warn(`cloud yêu cầu cập nhật >= ${msg.min_ver} (chưa hỗ trợ ở bản này)`)
        return
    }
  }

  // -------------------------------------------------------------------------
  // Bộ hẹn giờ
  // -------------------------------------------------------------------------

  /**
   * Gom mẫu của các terminal đang được xem thành MỘT tin `batch`. Không ai xem: không gửi gì.
   * Mỗi terminal có nhịp riêng: xem riêng thì theo tick (`fastPushMs`), chỉ trong danh sách thì
   * mỗi `push_sec` giây. Mẫu chưa tới nhịp được giữ lại cho lần sau, không mất.
   */
  flush(): void {
    if (!this.send || this.watch.size === 0) return
    const now = this.now()
    const items: Extract<GwClientMessage, { t: 'batch' }>['items'] = []
    for (const tid of this.watch) {
      const t = this.terminals.get(tid)
      if (!t || !this.isWatched(t)) continue
      if (t.buffer.length === 0 && !t.posDirty && !t.pl) continue
      const every = this.isFast(t) ? GW.fastPushMs : this.pushSec * 1000
      if (t.lastPushMs !== 0 && now - t.lastPushMs < every - PUSH_SLACK_MS) continue
      // Không có gì mới (thị trường đóng, lãi/lỗ không đổi): chỉ giữ mẫu mới nhất và đẩy một mẫu
      // giữ sống mỗi `keepAliveMs`, để người xem vẫn thấy Live mà cloud không phải nhận từng giây.
      const plJson = !t.posDirty && t.pl ? JSON.stringify(t.pl) : undefined
      const quiet =
        !t.posDirty &&
        (plJson === undefined || plJson === t.lastPlJson) &&
        t.buffer.every((s) => sameValues(s, t.lastSent))
      if (quiet && t.lastSentAtMs !== 0 && now - t.lastSentAtMs < GW.keepAliveMs) {
        if (t.buffer.length > 1) t.buffer.splice(0, t.buffer.length - 1)
        t.pl = undefined
        continue
      }
      t.lastPushMs = now
      const samples = t.buffer.splice(0, t.buffer.length)
      t.lastSent = samples.at(-1) ?? t.lastSent
      t.lastSentAtMs = now
      if (t.posDirty) t.lastPlJson = undefined
      else if (plJson !== undefined) t.lastPlJson = plJson
      items.push({
        tid,
        samples,
        ...(t.posDirty && t.positions ? { positions: t.positions, pos_hash: t.posHash } : {}),
        ...(!t.posDirty && t.pl ? { pl: t.pl } : {}),
      })
      t.posDirty = false
      t.pl = undefined
    }
    if (items.length > 0) this.send({ t: 'batch', items })
  }

  /** Terminal im quá `offlineAfterSec` thì offline: báo cloud một lần, ngừng giữ mẫu. */
  sweep(): void {
    const now = this.now()
    if (this.send && this.watch.size === 0 && !this.holdDeferred()) this.flushDeferred()
    for (const t of this.terminals.values()) {
      if (t.alerts.size > 0) this.sendAlerts(t)
      this.sweepTrade(t, now)
      if (t.online && now - t.lastSeenMs > GW.offlineAfterSec * 1000) {
        t.online = false
        t.buffer = []
        this.log.warn(`terminal ${t.tid} offline (im ${GW.offlineAfterSec}s)`)
        this.syncState(t)
      }
    }
  }

  // -------------------------------------------------------------------------
  // Trạng thái
  // -------------------------------------------------------------------------

  status(): GatewayStatus {
    const now = this.now()
    return {
      version: GATEWAY_VERSION,
      vps: this.opts.vps ?? '',
      cloud: { configured: this.opts.cloudConfigured ?? false, connected: this.send !== null },
      uptimeSec: Math.round((now - this.startedMs) / 1000),
      pushSec: this.pushSec,
      watched: [...this.terminals.values()].filter((t) => this.isWatched(t)).length,
      fast: [...this.terminals.values()].filter((t) => this.isFast(t)).length,
      queued: this.queue.length,
      droppedEvents: this.queue.dropped,
      alertBp: this.alertBp,
      terminals: [...this.terminals.values()].map((t) => ({
        tid: t.tid,
        login: t.login,
        server: t.server,
        mode: t.mode,
        eaVer: t.eaVer,
        online: t.online,
        conn: t.conn,
        bind: t.bind,
        code: t.code,
        watching: this.isWatched(t),
        lastSeenSec: Math.round((now - t.lastSeenMs) / 1000),
        queued: this.queue.forTerminal(t.tid).length,
      })),
    }
  }

  // -------------------------------------------------------------------------
  // Nội bộ
  // -------------------------------------------------------------------------

  private createTerminal(tid: string, req: PingRequest, now: number): Terminal {
    return {
      tid,
      sid: req.sid,
      key: req.key,
      login: req.login,
      server: req.server,
      mode: req.mode,
      broker: req.broker,
      name: req.name,
      eaVer: req.ea_ver,
      snap: req.snap,
      online: true,
      conn: req.conn,
      lastSeenMs: now,
      bind: 'pending',
      code: 0,
      bindSent: false,
      pushedOnline: null,
      lastEaSeq: { samples: 0, event: 0 },
      buffer: [],
      posDirty: false,
      lastPushMs: 0,
      inflight: new Set(),
      lastSentAtMs: 0,
      alerts: new Map(),
      tradeResults: new Map(),
    }
  }

  private refreshTerminal(t: Terminal, req: PingRequest, now: number): void {
    const wasOnline = t.online
    t.lastSeenMs = now
    t.online = true
    t.snap = req.snap
    t.mode = req.mode
    // EA đổi phiên bản (biên dịch lại, gắn lại): báo cloud lại để UI hiện đúng bản đang chạy.
    if (t.eaVer !== req.ea_ver) t.pushedOnline = null
    t.eaVer = req.ea_ver
    t.broker = req.broker ?? t.broker
    t.name = req.name ?? t.name

    if (t.sid !== req.sid) {
      // EA khởi động lại: phiên mới, seq về 0, bỏ mẫu cũ.
      t.sid = req.sid
      t.lastEaSeq = { samples: 0, event: 0 }
      t.buffer = []
      t.posDirty = false
      t.pl = undefined
    }
    if (t.key !== req.key) {
      // Người dùng đổi InpApiKey: bind lại từ đầu, bỏ lô sự kiện của khóa cũ.
      t.key = req.key
      t.bind = 'pending'
      t.code = 0
      t.bindSent = false
      this.watch.delete(t.tid)
      this.fast.delete(t.tid)
      this.queue.dropTerminal(t.tid)
    }
    if (t.conn !== req.conn) {
      t.conn = req.conn
      this.log.info(`terminal ${t.tid} ${req.conn ? 'nối lại' : 'mất kết nối'} broker`)
    }
    if (!wasOnline) this.log.info(`terminal ${t.tid} online trở lại`)
  }

  /** Gửi `bind` nếu cloud đang nối và chưa gửi cho kết nối này. */
  private syncBind(t: Terminal): void {
    if (!this.send || t.bindSent || t.bind === 'rejected') return
    const ok = this.send({
      t: 'bind',
      tid: t.tid,
      key: t.key,
      login: t.login,
      server: t.server,
      mode: t.mode,
      broker: t.broker,
      name: t.name,
      ea_ver: t.eaVer || undefined,
    })
    if (ok) t.bindSent = true
  }

  /** Báo `state` khi trạng thái hiệu dụng (online và nối broker) đổi, chỉ sau khi bind ok. */
  private syncState(t: Terminal): void {
    if (!this.send || t.bind !== 'ok') return
    const effective = t.online && t.conn
    if (t.pushedOnline === effective) return
    if (
      this.send({
        t: 'state',
        tid: t.tid,
        online: effective,
        snap: t.snap,
        ea_ver: t.eaVer || undefined,
      })
    ) {
      t.pushedOnline = effective
    }
  }

  /** Gửi báo cáo cảnh báo chưa xác nhận (chỉ khi bind ok); báo cáo vừa gửi chưa quá `ALERT_RESEND_MS` thì chờ. */
  private sendAlerts(t: Terminal): void {
    if (!this.send || t.bind !== 'ok' || t.alerts.size === 0) return
    const now = this.now()
    for (const p of t.alerts.values()) {
      if (p.sentMs !== 0 && now - p.sentMs < ALERT_RESEND_MS) continue
      const { aseq, kind, ts, bal, eq, fl, n, ccy, closed_pl } = p.req
      const ok = this.send({
        t: 'alert',
        tid: t.tid,
        aseq,
        kind,
        ts,
        bal,
        eq,
        fl,
        n,
        ...(ccy !== undefined ? { ccy } : {}),
        ...(closed_pl !== undefined ? { closed_pl } : {}),
      })
      if (ok) p.sentMs = now
    }
  }

  /** Gửi các lô sự kiện chưa gửi của terminal (chỉ khi bind ok). */
  private drainQueue(t: Terminal, force = false): void {
    if (!this.send || t.bind !== 'ok') return
    if (!force && this.holdDeferred()) return
    for (const item of this.queue.forTerminal(t.tid)) {
      if (t.inflight.has(item.seq)) continue
      const ok = this.send({
        t: 'event',
        tid: item.tid,
        seq: item.seq,
        reason: item.reason,
        events: item.events,
        snap: item.snap,
      })
      if (ok) t.inflight.add(item.seq)
    }
  }

  /**
   * Không ai xem thì `event` (lệnh vào/ra) chờ ở Gateway. `bind` và `state` vẫn đi ngay: hub cần
   * biết terminal để tính `watch`, và danh sách web lấy trạng thái online từ hub; `state` chỉ đổi
   * vài chục lần mỗi ngày. Hết giữ khi: có người xem (watch khác rỗng), đủ `idleFlushSec`, hoặc
   * hàng đợi đạt `idleFlushQueue`. Nhờ vậy cả ngày không ai đăng nhập chỉ còn vài lần đẩy gộp.
   */
  private holdDeferred(): boolean {
    const idleSec = this.opts.idleFlushSec ?? GW.idleFlushSec
    if (idleSec <= 0 || this.watch.size > 0) return false
    if (this.queue.length >= GW.idleFlushQueue) return false
    return this.now() - this.lastDeferredMs < idleSec * 1000
  }

  /** Đẩy mọi `event` đang giữ, rồi đặt lại mốc giữ. */
  private flushDeferred(): void {
    this.lastDeferredMs = this.now()
    for (const t of this.terminals.values()) this.drainQueue(t, true)
  }

  private isWatched(t: Terminal): boolean {
    return t.bind === 'ok' && t.online && this.watch.has(t.tid) && this.send !== null
  }

  /** Terminal đang được xem riêng: EA gửi theo tick, Gateway đẩy lên cloud cùng nhịp. */
  private isFast(t: Terminal): boolean {
    return this.isWatched(t) && this.fast.has(t.tid)
  }

  private pingResponse(t: Terminal): LocalPingResponse {
    return {
      ok: true,
      bind: t.bind,
      code: t.code,
      watch: this.isWatched(t),
      interval_ms: this.isFast(t) ? GW.fastIntervalMs : clampIntervalMs(this.pushSec * 1000),
      lease_ms: GW.leaseMs,
      alert_bp: this.alertBp,
      ...this.tradeFields(t),
    }
  }

  private idleResponse(): LocalPingResponse {
    return {
      ok: true,
      bind: 'pending',
      code: 0,
      watch: false,
      interval_ms: clampIntervalMs(this.pushSec * 1000),
      lease_ms: GW.leaseMs,
      alert_bp: this.alertBp,
    }
  }

  // -------------------------------------------------------------------------
  // Giao dịch thủ công (v0.2.6)
  // -------------------------------------------------------------------------

  /** Báo cloud kết quả mà Gateway tự quyết (không do EA): lệnh bị từ chối ngay hoặc quá hạn. */
  private failTrade(
    tid: string,
    cmdId: string,
    status: 'failed' | 'timeout',
    reason: 'terminal_offline' | 'busy' | 'bad_request' | 'no_reply',
    detail: string,
  ): void {
    this.send?.({ t: 'trade_result', tid, cmd_id: cmdId, status, reason, code: 0, detail })
  }

  /**
   * Nhận lệnh từ cloud. Từ chối ngay (không giữ) khi terminal lạ/offline, đang có lệnh khác, hoặc lệnh
   * thiếu trường: lệnh thị trường không được xếp hàng chờ. Lệnh nhận được giữ tới khi EA báo kết quả.
   */
  private acceptTrade(msg: Extract<GwServerMessage, { t: 'trade' }>): void {
    const t = this.terminals.get(msg.tid)
    if (!t?.online || t.bind !== 'ok') {
      this.failTrade(msg.tid, msg.cmd_id, 'failed', 'terminal_offline', 'terminal not ready')
      return
    }
    if (t.trade) {
      this.failTrade(msg.tid, msg.cmd_id, 'failed', 'busy', 'previous command pending')
      return
    }
    const hasTicket = msg.ticket !== undefined
    const stops = msg.sl !== undefined && msg.tp !== undefined
    const complete =
      (msg.op === 'close' && hasTicket) ||
      (msg.op === 'partial_close' && hasTicket && msg.volume !== undefined) ||
      (msg.op === 'modify' && hasTicket && stops) ||
      (msg.op === 'market' &&
        msg.symbol !== undefined &&
        msg.side !== undefined &&
        msg.volume !== undefined &&
        stops) ||
      (msg.op === 'pending' &&
        msg.symbol !== undefined &&
        msg.kind !== undefined &&
        msg.volume !== undefined &&
        msg.price !== undefined &&
        stops) ||
      (msg.op === 'close_all' && msg.filter !== undefined)
    if (!complete) {
      this.failTrade(msg.tid, msg.cmd_id, 'failed', 'bad_request', 'missing fields')
      return
    }
    t.trade = { cmd: msg, expiresMs: this.now() + TRADE.ttlMs }
    this.log.info(
      `lệnh giao dịch ${msg.op}${msg.ticket !== undefined ? ` #${msg.ticket}` : ''} cho ${msg.tid} (${msg.cmd_id})`,
    )
  }

  /**
   * Quá hạn thì EA không còn bắt đầu thực thi (EA tự kiểm `tr_ttl`). Gateway chờ thêm `graceMs` rồi mới báo
   * `timeout`, để không báo sai khi EA đang chạy dở sát hạn. `timeout` nghĩa là KHÔNG BIẾT: người dùng phải
   * xem lại bảng lệnh. Kết quả muộn của EA, nếu có, vẫn được chuyển tiếp và ghi đè.
   */
  private sweepTrade(t: Terminal, now: number): void {
    const p = t.trade
    if (!p || now < p.expiresMs + TRADE.graceMs) return
    t.trade = undefined
    this.failTrade(t.tid, p.cmd.cmd_id, 'timeout', 'no_reply', 'no reply from EA')
  }

  /** Các trường `tr_*` của phản hồi cho EA; rỗng khi không có lệnh hoặc lệnh đã hết hạn. */
  private tradeFields(t: Terminal): Partial<LocalPingResponse> {
    const p = t.trade
    if (!p) return {}
    const ttl = p.expiresMs - this.now()
    if (ttl <= 0) return {}
    const c = p.cmd
    return {
      tr_id: c.cmd_id,
      tr_op: c.op,
      ...(c.ticket !== undefined ? { tr_ticket: c.ticket } : {}),
      ...(c.symbol !== undefined ? { tr_sym: c.symbol } : {}),
      ...(c.side !== undefined ? { tr_side: c.side } : {}),
      ...(c.kind !== undefined ? { tr_kind: c.kind } : {}),
      ...(c.price !== undefined ? { tr_px: c.price } : {}),
      ...(c.filter !== undefined ? { tr_filter: c.filter } : {}),
      ...(c.volume !== undefined ? { tr_vol: c.volume } : {}),
      ...(c.sl !== undefined ? { tr_sl: c.sl } : {}),
      ...(c.tp !== undefined ? { tr_tp: c.tp } : {}),
      tr_ttl: ttl,
    }
  }

  /** Gửi kết quả EA báo (chỉ khi bind ok). Xóa sau khi gửi: hub luôn xử lý, không cần ack riêng. */
  private sendTradeResults(t: Terminal): void {
    if (!this.send || t.bind !== 'ok') return
    for (const [id, r] of t.tradeResults) {
      const ok = this.send({
        t: 'trade_result',
        tid: t.tid,
        cmd_id: r.cmd_id,
        status: r.status,
        reason: r.reason,
        code: r.code,
        detail: r.detail,
        ...(r.left !== undefined ? { left: r.left } : {}),
        ...(r.order !== undefined ? { order: r.order } : {}),
        ...(r.n_ok !== undefined ? { n_ok: r.n_ok } : {}),
        ...(r.n_fail !== undefined ? { n_fail: r.n_fail } : {}),
      })
      if (ok) t.tradeResults.delete(id)
    }
  }

  /** `seq` gửi cloud: đơn điệu theo thời gian nên không lùi khi mất file hàng đợi. */
  private nextGseq(): number {
    this.lastGseq = Math.max(this.lastGseq + 1, this.now())
    return this.lastGseq
  }
}
