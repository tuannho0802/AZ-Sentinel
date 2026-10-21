import {
  type BindState,
  clampIntervalMs,
  clampPushSec,
  type EventRequest,
  GW,
  type GwClientMessage,
  type GwServerMessage,
  type LocalEventResponse,
  type LocalPingResponse,
  type PingRequest,
  type Position,
  type PositionPl,
  type Sample,
  type SamplesRequest,
  type Snap,
  terminalId,
} from '@az-sentinel/shared'
import { type Logger, silentLogger } from './log'
import { EventQueue } from './queue'

export const GATEWAY_VERSION = '0.1.0'

/** Trần số mẫu giữ cho mỗi terminal giữa hai lần gom (push tối đa 5 giây, 1 mẫu/giây). */
const MAX_BUFFER = 60

/** Dung sai (ms) khi so nhịp đẩy: bộ hẹn giờ lệch vài ms không được làm lỡ một nhịp. */
const PUSH_SLACK_MS = 20

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
  cloud: { configured: boolean; connected: boolean }
  uptimeSec: number
  pushSec: number
  watched: number
  /** Số terminal đang được xem riêng (trang chi tiết): EA gửi và Gateway đẩy theo tick. */
  fast: number
  queued: number
  droppedEvents: number
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

  handlePing(req: PingRequest): LocalPingResponse {
    const now = this.now()
    const tid = terminalId(req.login, req.server)
    let t = this.terminals.get(tid)

    if (!t) {
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
        return
      }
      case 'reject': {
        const t = this.terminals.get(msg.tid)
        if (!t) return
        t.bind = 'rejected'
        t.code = msg.code
        t.buffer = []
        this.watch.delete(msg.tid)
        this.fast.delete(msg.tid)
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
      cloud: { configured: this.opts.cloudConfigured ?? false, connected: this.send !== null },
      uptimeSec: Math.round((now - this.startedMs) / 1000),
      pushSec: this.pushSec,
      watched: [...this.terminals.values()].filter((t) => this.isWatched(t)).length,
      fast: [...this.terminals.values()].filter((t) => this.isFast(t)).length,
      queued: this.queue.length,
      droppedEvents: this.queue.dropped,
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
    }
  }

  /** `seq` gửi cloud: đơn điệu theo thời gian nên không lùi khi mất file hàng đợi. */
  private nextGseq(): number {
    this.lastGseq = Math.max(this.lastGseq + 1, this.now())
    return this.lastGseq
  }
}
