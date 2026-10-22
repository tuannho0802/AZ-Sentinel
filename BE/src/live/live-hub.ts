import { DurableObject } from 'cloudflare:workers'
import {
  type ClientMessage,
  clientMessageSchema,
  GW,
  type GwClientMessage,
  type GwServerMessage,
  gwClientMessageSchema,
  type KickReason,
  LIVE,
  type LiveState,
  normalizeVpsLabel,
  type Position,
  type Sample,
  type ServerMessage,
  type SnapshotLink,
  terminalId,
} from '@az-sentinel/shared'
import { sha256Hex } from '../lib/crypto'
import { m5Slot } from '../lib/time'
import {
  bindTerminal,
  eventStatements,
  liveWriteStatements,
  presenceStatements,
} from '../services/gw-service'
import { normalizeSamples, sameSample } from '../services/live-service'
import type { Bindings } from '../types'
import { GW_HEADER, MAX_GW_TERMS } from './gw-header'
import type {
  ConnAttachment,
  GwAttachment,
  GwTerm,
  HubLinkRef,
  HubStats,
  LiveScope,
  PublishInput,
  PublishResult,
} from './hub-types'
import { scopeMatches } from './scope'
import { decodeViewer, VIEWER_HEADER } from './viewer-header'
import { upgradeResponse } from './ws-response'

const WS_OPEN = 1
const MAX_CLIENT_MESSAGE_CHARS = 512
/** `batch` của một VPS: tối đa 64 terminal x 20 mẫu và vị thế; chừa dư cho `event`. */
const MAX_GW_MESSAGE_CHARS = 2 * 1024 * 1024
/** Khóa storage của danh sách terminal theo từng kết nối Gateway. */
const GW_TERMS_PREFIX = 'gw:'
/** Gateway im quá chừng này (kể cả ping giao thức) thì coi là chết. */
const GW_DEAD_AFTER_MS = GW.wsPingSec * 2.5 * 1000
/** `link_state` ghi điều tiết khi có người xem (Plan 3C mục 5). */
const GW_STATE_WRITE_SEC = 300
/** Cắt phiên bản EA lưu trong attachment của Gateway (giới hạn 2 KB cho cả kết nối). */
const MAX_EA_VER = 16
const VIEWER_TAG = 'viewer'
const GW_TAG = 'gw'
/** Giới hạn bộ nhớ: số liên kết hub nhớ trạng thái (đủ rộng cho 30 EA, chặn tăng vô hạn). */
const MAX_TRACKED_LINKS = 500

/** Trạng thái theo từng liên kết, chỉ nằm trong bộ nhớ (mất khi hub ngủ đông là chấp nhận được). */
type LinkMemory = {
  ownerId: number | null
  lastSid: string | null
  lastSeq: number
  lastT: number
  lastIngestAt: number
  lastLiveAt: number
  lastBarSlot: number
  /** Giờ (giây) ghi link_state gần nhất do đường Gateway; 0 = chưa. */
  lastStateWriteSec: number
  lastPosHash: string | null
  lastSample: Sample | null
  positions: Position[] | null
  posHash: string | null
}

type Conn = { ws: WebSocket; att: ConnAttachment }

const NO_DECISION: PublishResult = {
  wanted: false,
  duplicate: false,
  rateLimited: false,
  retryAfterSec: 0,
  barDue: false,
  posChanged: false,
}

/**
 * Hub live toàn cục (Plan 3B mục 7). Giữ danh sách người xem WebSocket và phát mẫu realtime.
 *
 * Quy tắc sống còn của Hibernation:
 * - Kết nối do `ctx.acceptWebSocket` quản lý; trạng thái từng kết nối nằm ở `serializeAttachment`,
 *   KHÔNG nằm ở biến bộ nhớ (biến mất khi hub ngủ đông).
 * - Không dùng `setInterval`, alarm hay fetch treo: chúng chặn ngủ đông và tốn thời gian chạy.
 * - Viewer chết (cắt mạng đột ngột không có `close`) chỉ phát hiện bằng `hb`, dọn lười khi có
 *   gate hoặc ingest (`aliveConns`).
 * - Hub không đọc D1. Storage chỉ giữ danh sách terminal của từng Gateway (`gw:<connId>`), ghi khi\n *   `bind` hoặc khi terminal đổi online/offline: vài dòng mỗi ngày, không ghi theo tick.
 * - Mọi mốc thời gian đi vào qua tham số `nowMs` do Worker truyền để test xác định được.
 */
export class LiveHub extends DurableObject<Bindings> {
  private links = new Map<number, LinkMemory>()
  private rpcCalls = 0
  /** Tập `watch` đã gửi cho mỗi Gateway (chỉ để khỏi gửi trùng; mất khi ngủ đông thì gửi lại). */
  private lastWatch = new Map<string, string>()
  /** Bản nhớ của danh sách terminal theo connId; nạp lười từ storage sau khi hub ngủ đông. */
  private gwTerms = new Map<string, GwTerm[]>()

  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env)
    // Gateway giữ nhịp bằng "ping" văn bản; hub đáp "pong" mà không bị đánh thức khỏi ngủ đông.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
    this.purgeOrphanTerms()
  }

  // ---------------------------------------------------------------- WebSocket (trình duyệt)

  override async fetch(request: Request): Promise<Response> {
    this.rpcCalls += 1
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }
    if (request.headers.get(GW_HEADER) === '1') return this.acceptGateway()
    const viewer = decodeViewer(request.headers.get(VIEWER_HEADER))
    if (!viewer) return new Response('Bad viewer', { status: 400 })

    const mine = this.aliveConns(viewer.nowMs).filter((c) => c.att.userId === viewer.userId).length
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    this.ctx.acceptWebSocket(server, [VIEWER_TAG])
    const att: ConnAttachment = {
      connId: crypto.randomUUID(),
      userId: viewer.userId,
      role: viewer.role,
      scope: viewer.scope,
      lastBeatAt: viewer.nowMs,
      expiresAt: viewer.expiresAt,
      hello: false,
    }
    server.serializeAttachment(att)
    // Trình duyệt không đọc được mã HTTP của lần nâng cấp thất bại, nên chấp nhận rồi mới đá.
    if (mine >= LIVE.maxTabsPerUser) this.kick(server, 'too_many_tabs')
    else this.syncWatch(viewer.nowMs)
    return upgradeResponse(client)
  }

  /**
   * Kết nối của Gateway (Plan 3C). Không gửi `hello` trong 10 giây thì đóng (B-31). Cố ý KHÔNG
   * đòi `bind` hợp lệ: Gateway chưa có EA nào (hoặc khóa bị từ chối) vẫn phải giữ kết nối,
   * nếu không nó sẽ nối lại liên tục.
   */
  private acceptGateway(): Response {
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    this.ctx.acceptWebSocket(server, [GW_TAG])
    const now = Date.now()
    const att: GwAttachment = {
      connId: crypto.randomUUID(),
      openedAt: now,
      lastBeatAt: now,
      hello: false,
      vps: null,
    }
    server.serializeAttachment(att)
    // setTimeout giữ hub thức tối đa 10 giây mỗi lần Gateway nối: chấp nhận được.
    setTimeout(() => {
      const cur = this.readGw(server)
      if (cur && !cur.hello && server.readyState === WS_OPEN) server.close(4001, 'hello timeout')
    }, GW.bindTimeoutSec * 1000)
    return upgradeResponse(client)
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (this.ctx.getTags(ws).includes(GW_TAG)) {
      await this.onGwMessage(ws, message)
      return
    }
    const att = ws.deserializeAttachment() as ConnAttachment | null
    if (!att) {
      ws.close(1011, 'no_state')
      return
    }
    if (typeof message !== 'string' || message.length > MAX_CLIENT_MESSAGE_CHARS) {
      ws.close(1009, 'bad_message')
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(message)
    } catch {
      return
    }
    const msg = clientMessageSchema.safeParse(parsed)
    if (!msg.success) return

    const now = Date.now()
    att.lastBeatAt = now
    if (msg.data.t === 'hello') {
      if (!helloMatchesScope(att.scope, msg.data)) {
        ws.close(1008, 'scope_mismatch')
        return
      }
      att.hello = true
      ws.serializeAttachment(att)
      this.sendSnapshot(ws, att, now)
      this.syncWatch(now)
      return
    }
    ws.serializeAttachment(att)
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    await this.onClosed(ws)
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    try {
      ws.close(1011, 'error')
    } catch {
      // đã đóng
    }
    await this.onClosed(ws)
  }

  /**
   * Viewer rời: chỉ cần tính lại `watch`. Gateway rời: mọi terminal của nó thành offline (ghi D1
   * theo chuyển trạng thái) và quên tập `watch` đã gửi.
   */
  private async onClosed(ws: WebSocket): Promise<void> {
    if (this.ctx.getTags(ws).includes(GW_TAG)) {
      const att = this.readGw(ws)
      if (att) {
        this.lastWatch.delete(att.connId)
        const terms = this.loadTerms(att.connId)
        this.dropTerms(att.connId)
        await this.markOffline(terms)
      }
      return
    }
    this.syncWatch(Date.now())
  }

  // ---------------------------------------------------------------- RPC (từ Worker)

  /** Gate của EA: có người xem liên kết này không. Không ghi, không tạo bộ nhớ. */
  async shouldBeLive(ref: HubLinkRef, nowMs: number): Promise<{ wanted: boolean }> {
    this.rpcCalls += 1
    return { wanted: this.aliveConns(nowMs).some((c) => scopeMatches(c.att.scope, ref)) }
  }

  /**
   * Ingest live của EA. Hub quyết định: có người xem không, có quá nhanh không, có trùng không,
   * và nến M5/cấu trúc lệnh có "đến hạn" ghi D1 không. Hub phát cho người xem; Worker ghi D1
   * (độc lập với việc trùng, để lỗi D1 rồi EA gửi lại không làm mất sự kiện giao dịch).
   */
  async publish(input: PublishInput): Promise<PublishResult> {
    this.rpcCalls += 1
    const { ref, nowMs } = input
    const conns = this.aliveConns(nowMs)
    const viewers = conns.filter((c) => scopeMatches(c.att.scope, ref))
    if (viewers.length === 0) return NO_DECISION

    const mem = this.memoryFor(ref)
    const decision: PublishResult = { ...NO_DECISION, wanted: true }

    if (mem.lastIngestAt !== 0 && nowMs - mem.lastIngestAt < LIVE.minIngestGapSec * 1000) {
      return { ...decision, rateLimited: true, retryAfterSec: LIVE.minIngestGapSec }
    }
    if (mem.lastSid === input.sid && input.seq <= mem.lastSeq) {
      return { ...decision, duplicate: true }
    }

    return this.applyPublish(input, viewers, mem, decision)
  }

  /** Phần chung của `publish` (HTTP cũ) và đường Gateway: cập nhật bộ nhớ và phát cho người xem. */
  private applyPublish(
    input: PublishInput,
    viewers: Conn[],
    mem: LinkMemory,
    decision: PublishResult,
  ): PublishResult {
    const { ref, nowMs } = input
    const wasLive = this.stateOf(mem, nowMs) === 'live'
    mem.lastSid = input.sid
    mem.lastSeq = input.seq
    mem.lastIngestAt = nowMs
    mem.lastLiveAt = nowMs

    // `t` là Unix giây nên nhiều tick rơi vào cùng một giây: chấp nhận `t` bằng mốc cũ nếu giá trị
    // khác (tin đến sau là mới hơn, cùng một kết nối có thứ tự). Bỏ mẫu lùi về trước và bản trùng.
    const fresh = input.samples.filter(
      (s) => s.t > mem.lastT || (s.t === mem.lastT && !sameSample(s, mem.lastSample)),
    )
    const last = fresh.at(-1)
    if (last) {
      mem.lastT = last.t
      mem.lastSample = last
    }

    const slot = m5Slot(Math.floor(nowMs / 1000))
    // Chỉ ghi nến khi VỪA QUA ranh giới M5 (lần đầu sau khi hub nhớ liên kết chỉ đặt mốc).
    // Nến bị lỡ lúc idle được `backfill` bù.
    decision.barDue = mem.lastBarSlot !== -1 && mem.lastBarSlot !== slot
    mem.lastBarSlot = slot

    if (input.positions !== undefined) {
      decision.posChanged = input.posHash === undefined || input.posHash !== mem.lastPosHash
      mem.lastPosHash = input.posHash ?? null
      mem.positions = input.positions
      mem.posHash = input.posHash ?? null
    }

    // Lãi/lỗ từng lệnh: cập nhật bản nhớ để `snapshot` của viewer vào sau luôn mới.
    const pl = input.positions === undefined ? input.pl : undefined
    if (pl && mem.positions) {
      mem.positions = mem.positions.map((p) => {
        const profit = pl[String(p.ticket)]
        return profit === undefined ? p : { ...p, profit }
      })
    }

    const serverTime = Math.floor(nowMs / 1000)
    const out: ServerMessage[] = []
    if (!wasLive)
      out.push({ t: 'live_state', id: ref.linkId, server_time: serverTime, state: 'live' })
    if (fresh.length > 0) {
      out.push({ t: 'samples', id: ref.linkId, server_time: serverTime, samples: fresh })
    }
    if (input.positions !== undefined) {
      out.push({
        t: 'positions',
        id: ref.linkId,
        server_time: serverTime,
        positions: input.positions,
        ...(input.posHash !== undefined ? { pos_hash: input.posHash } : {}),
      })
    }
    const detailViewers = viewers.filter((v) => v.att.scope.kind === 'link')
    for (const message of out) {
      if (message.t === 'samples' && pl) {
        // `pl` chỉ cần cho viewer xem riêng một liên kết; danh sách chỉ hiện tổng lãi/lỗ.
        this.broadcast(detailViewers, { ...message, pl })
        this.broadcast(
          viewers.filter((v) => v.att.scope.kind !== 'link'),
          message,
        )
      } else {
        this.broadcast(viewers, message)
      }
    }
    return decision
  }

  /** Đá mọi kết nối của một người dùng (đăng xuất, hết phiên). Trả số kết nối đã đá. */
  async kickUser(userId: number, reason: KickReason): Promise<number> {
    this.rpcCalls += 1
    let n = 0
    for (const ws of this.ctx.getWebSockets(VIEWER_TAG)) {
      const att = ws.deserializeAttachment() as ConnAttachment | null
      if (att?.userId === userId) {
        this.kick(ws, reason)
        n += 1
      }
    }
    this.syncWatch(Date.now())
    return n
  }

  /** Các liên kết có terminal đang online qua một Gateway còn sống (danh sách liên kết dùng). */
  async onlineLinkIds(nowMs: number): Promise<number[]> {
    this.rpcCalls += 1
    const ids = new Set<number>()
    for (const ws of this.ctx.getWebSockets(GW_TAG)) {
      const att = this.readGw(ws)
      if (!att || ws.readyState !== WS_OPEN || !this.gwAlive(ws, att, nowMs)) continue
      for (const t of this.loadTerms(att.connId)) if (t.online) ids.add(t.linkId)
    }
    return [...ids]
  }

  /** Khóa bị khóa, cấp lại hoặc gỡ gắn (B-38): bảo Gateway bỏ terminal và ngừng phát. */
  async revokeLink(linkId: number): Promise<number> {
    this.rpcCalls += 1
    let n = 0
    for (const ws of this.ctx.getWebSockets(GW_TAG)) {
      const att = this.readGw(ws)
      if (!att) continue
      const terms = this.loadTerms(att.connId)
      const gone = terms.filter((t) => t.linkId === linkId)
      if (gone.length === 0) continue
      this.saveTerms(
        att.connId,
        terms.filter((t) => t.linkId !== linkId),
      )
      for (const t of gone) {
        this.sendGw(ws, { t: 'reject', tid: t.tid, code: 403 })
        n += 1
      }
      const offline = gone.filter((t) => t.online)
      if (offline.length > 0) await this.markOffline(offline)
    }
    this.syncWatch(Date.now())
    return n
  }

  async stats(nowMs: number): Promise<HubStats> {
    return {
      viewers: this.aliveConns(nowMs).length,
      gateways: this.ctx.getWebSockets(GW_TAG).filter((ws) => ws.readyState === WS_OPEN).length,
      linksTracked: this.links.size,
      rpcCalls: this.rpcCalls,
    }
  }

  // ---------------------------------------------------------------- nội bộ

  /**
   * Kết nối còn sống: đang mở, chưa hết phiên, có tin trong 60 giây gần nhất. Kết nối chết hoặc
   * hết phiên bị đóng ngay tại đây (dọn lười, không cần timer).
   */
  private aliveConns(nowMs: number): Conn[] {
    const alive: Conn[] = []
    for (const ws of this.ctx.getWebSockets(VIEWER_TAG)) {
      if (ws.readyState !== WS_OPEN) continue
      const att = ws.deserializeAttachment() as ConnAttachment | null
      if (!att) {
        ws.close(1011, 'no_state')
        continue
      }
      if (att.expiresAt !== null && nowMs >= att.expiresAt) {
        this.kick(ws, 'session_expired')
        continue
      }
      if (nowMs - att.lastBeatAt > LIVE.viewerTimeoutSec * 1000) {
        ws.close(1001, 'heartbeat_timeout')
        continue
      }
      alive.push({ ws, att })
    }
    return alive
  }

  private kick(ws: WebSocket, reason: KickReason): void {
    try {
      ws.send(JSON.stringify({ t: 'kick', reason } satisfies ServerMessage))
      ws.close(1008, reason)
    } catch {
      // đã đóng
    }
  }

  private broadcast(conns: Conn[], message: ServerMessage): void {
    const text = JSON.stringify(message)
    for (const { ws, att } of conns) {
      if (!att.hello) continue
      try {
        ws.send(text)
      } catch {
        // kết nối vừa đóng; lần dọn sau sẽ bỏ
      }
    }
  }

  private memoryFor(ref: HubLinkRef): LinkMemory {
    let mem = this.links.get(ref.linkId)
    if (!mem) {
      if (this.links.size >= MAX_TRACKED_LINKS) {
        const oldest = this.links.keys().next().value
        if (oldest !== undefined) this.links.delete(oldest)
      }
      mem = {
        ownerId: ref.ownerId,
        lastSid: null,
        lastSeq: -1,
        lastT: 0,
        lastIngestAt: 0,
        lastLiveAt: 0,
        lastBarSlot: -1,
        lastStateWriteSec: 0,
        lastPosHash: null,
        lastSample: null,
        positions: null,
        posHash: null,
      }
      this.links.set(ref.linkId, mem)
    }
    mem.ownerId = ref.ownerId
    return mem
  }

  /** `live` khi mẫu gần nhất còn trong thời hạn lease; ngược lại `waking` (có người xem, EA chưa vào). */
  private stateOf(mem: LinkMemory, nowMs: number): LiveState {
    return mem.lastLiveAt !== 0 && nowMs - mem.lastLiveAt <= LIVE.leaseSec * 1000
      ? 'live'
      : 'waking'
  }

  // ---------------------------------------------------------------- Gateway (Plan 3C)

  private readGw(ws: WebSocket): GwAttachment | null {
    try {
      return (ws.deserializeAttachment() as GwAttachment | null) ?? null
    } catch {
      return null
    }
  }

  /** Còn sống: có tin hoặc ping giao thức (auto-response) trong `GW_DEAD_AFTER_MS` gần nhất. */
  private gwAlive(ws: WebSocket, att: GwAttachment, nowMs: number): boolean {
    const auto = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0
    return nowMs - Math.max(att.lastBeatAt, auto) <= GW_DEAD_AFTER_MS
  }

  /** Danh sách terminal của một kết nối Gateway: bộ nhớ trước, rồi storage (sau ngủ đông). */
  private loadTerms(connId: string): GwTerm[] {
    let terms = this.gwTerms.get(connId)
    if (!terms) {
      terms = this.ctx.storage.kv.get<GwTerm[]>(GW_TERMS_PREFIX + connId) ?? []
      this.gwTerms.set(connId, terms)
    }
    return terms
  }

  private saveTerms(connId: string, terms: GwTerm[]): void {
    this.gwTerms.set(connId, terms)
    this.ctx.storage.kv.put(GW_TERMS_PREFIX + connId, terms)
  }

  private dropTerms(connId: string): void {
    this.gwTerms.delete(connId)
    this.ctx.storage.kv.delete(GW_TERMS_PREFIX + connId)
  }

  /** Dọn khóa của kết nối Gateway không còn (hub bị khởi động lại làm các kết nối đóng). */
  private purgeOrphanTerms(): void {
    const live = new Set<string>()
    for (const ws of this.ctx.getWebSockets(GW_TAG)) {
      const att = this.readGw(ws)
      if (att) live.add(att.connId)
    }
    for (const [key] of this.ctx.storage.kv.list({ prefix: GW_TERMS_PREFIX })) {
      if (!live.has(key.slice(GW_TERMS_PREFIX.length))) this.ctx.storage.kv.delete(key)
    }
  }

  private sendGw(ws: WebSocket, msg: GwServerMessage): void {
    try {
      ws.send(JSON.stringify(msg))
    } catch {
      // đã đóng
    }
  }

  /** Chạy một thao tác D1; lỗi thì ghi log và trả null (Gateway giữ hàng đợi, gửi lại sau). */
  private async withDb<T>(fn: (db: D1Database) => Promise<T>): Promise<T | null> {
    try {
      return await fn(this.env.DB)
    } catch (error) {
      console.error(
        JSON.stringify({ level: 'error', msg: 'gw_d1_failed', err: String(error).slice(0, 200) }),
      )
      return null
    }
  }

  /**
   * Tính lại và đẩy tập `watch` cho mọi Gateway: các terminal đã bind mà có ít nhất một viewer
   * còn sống có phạm vi bao gồm. Chỉ gửi khi tập đổi (hoặc `force`). Viewer chết chỉ bị phát hiện
   * lười ở `aliveConns`, nên hàm này cũng được gọi khi `batch` đến mà không còn ai xem.
   */
  private syncWatch(nowMs: number, force?: WebSocket): void {
    const viewers = this.aliveConns(nowMs)
    for (const ws of this.ctx.getWebSockets(GW_TAG)) {
      const att = this.readGw(ws)
      if (!att || ws.readyState !== WS_OPEN) continue
      const watched = this.loadTerms(att.connId).filter((t) =>
        viewers.some((v) => scopeMatches(v.att.scope, t)),
      )
      const tids = watched.map((t) => t.tid).sort()
      // Xem riêng một liên kết (`/links/:id`): theo tick. Chỉ nằm trong danh sách: nhịp thường.
      const fast = watched
        .filter((t) =>
          viewers.some((v) => v.att.scope.kind === 'link' && scopeMatches(v.att.scope, t)),
        )
        .map((t) => t.tid)
        .sort()
      const key = `${tids.join('|')}#${fast.join('|')}`
      if (this.lastWatch.get(att.connId) === key && force !== ws) continue
      this.lastWatch.set(att.connId, key)
      this.sendGw(ws, { t: 'watch', tids, fast, push_sec: GW.defaultPushSec })
    }
  }

  private async onGwMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string' || message.length > MAX_GW_MESSAGE_CHARS) {
      ws.close(1009, 'bad_message')
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(message)
    } catch {
      return
    }
    const msg = gwClientMessageSchema.safeParse(parsed)
    if (!msg.success) return
    const now = Date.now()
    const att = this.readGw(ws)
    if (!att) {
      ws.close(1011, 'no_state')
      return
    }
    att.lastBeatAt = now
    if (msg.data.t === 'hello') {
      att.hello = true
      att.vps = normalizeVpsLabel(msg.data.vps ?? null)
    }
    ws.serializeAttachment(att)
    switch (msg.data.t) {
      case 'hello':
        return
      case 'bind':
        await this.gwBind(ws, msg.data, now)
        return
      case 'state':
        await this.gwState(ws, msg.data, now)
        return
      case 'batch':
        await this.gwBatch(ws, msg.data, now)
        return
      case 'event':
        await this.gwEvent(ws, msg.data, now)
        return
    }
  }

  private async gwBind(
    ws: WebSocket,
    msg: Extract<GwClientMessage, { t: 'bind' }>,
    nowMs: number,
  ): Promise<void> {
    if (msg.tid !== terminalId(msg.login, msg.server)) {
      this.sendGw(ws, { t: 'reject', tid: msg.tid, code: 400 })
      return
    }
    const keyHash = await sha256Hex(msg.key)
    const res = await this.withDb((db) => bindTerminal(db, msg, keyHash, Math.floor(nowMs / 1000)))
    if (res === null) return // D1 lỗi: im lặng; Gateway giữ "pending" và bind lại khi nối lại
    if (!res.ok) {
      this.sendGw(ws, { t: 'reject', tid: msg.tid, code: res.code })
      return
    }
    // Đọc lại attachment SAU await: các tin khác có thể đã xen vào.
    const att = this.readGw(ws)
    if (!att) return
    const term: GwTerm = {
      tid: msg.tid,
      linkId: res.linkId,
      ownerId: res.ownerId,
      online: false,
      ea: (msg.ea_ver ?? '').slice(0, MAX_EA_VER),
    }
    const next = [...this.loadTerms(att.connId).filter((t) => t.tid !== msg.tid), term]
    if (next.length > MAX_GW_TERMS) {
      this.sendGw(ws, { t: 'reject', tid: msg.tid, code: 429 })
      return
    }
    this.saveTerms(att.connId, next)
    this.sendGw(ws, { t: 'bound', tid: msg.tid, link_id: res.linkId })
    this.syncWatch(nowMs, ws)
  }

  private async gwState(
    ws: WebSocket,
    msg: Extract<GwClientMessage, { t: 'state' }>,
    nowMs: number,
  ): Promise<void> {
    const att = this.readGw(ws)
    const terms = att ? this.loadTerms(att.connId) : []
    const before = terms.find((t) => t.tid === msg.tid)
    if (!att || !before) return
    const eaVer = msg.ea_ver === undefined ? before.ea : msg.ea_ver.slice(0, MAX_EA_VER)
    // Trạng thái không đổi và EA vẫn cùng phiên bản: bỏ qua. EA đổi phiên bản thì vẫn ghi lại.
    if (before.online === msg.online && eaVer === before.ea) return
    // Cập nhật bộ nhớ trước khi chờ D1 để `state` lặp lại không ghi hai lần.
    this.saveTerms(
      att.connId,
      terms.map((t) => (t.tid === msg.tid ? { ...t, online: msg.online, ea: eaVer } : t)),
    )
    const stmts = presenceStatements(
      this.env.DB,
      before.linkId,
      msg.online,
      msg.snap,
      Math.floor(nowMs / 1000),
      { eaVer, vps: att.vps },
    )
    await this.withDb((db) => db.batch(stmts))
  }

  private async gwBatch(
    ws: WebSocket,
    msg: Extract<GwClientMessage, { t: 'batch' }>,
    nowMs: number,
  ): Promise<void> {
    const att = this.readGw(ws)
    if (!att) return
    const terms = this.loadTerms(att.connId)
    const nowSec = Math.floor(nowMs / 1000)
    const viewers = this.aliveConns(nowMs)
    const stmts: D1PreparedStatement[] = []
    let stale = false
    for (const item of msg.items) {
      const term = terms.find((t) => t.tid === item.tid)
      if (!term) continue
      const matched = viewers.filter((v) => scopeMatches(v.att.scope, term))
      if (matched.length === 0) {
        stale = true // không còn ai xem: bỏ (B-35) và bảo Gateway ngừng
        continue
      }
      const ref: HubLinkRef = { linkId: term.linkId, ownerId: term.ownerId }
      const mem = this.memoryFor(ref)
      const samples = normalizeSamples(item.samples, nowSec)
      const decision = this.applyPublish(
        {
          ref,
          sid: 'gw',
          seq: nowMs,
          samples,
          ...(item.positions !== undefined ? { positions: item.positions } : {}),
          ...(item.pos_hash !== undefined ? { posHash: item.pos_hash } : {}),
          ...(item.pl !== undefined ? { pl: item.pl } : {}),
          nowMs,
        },
        matched,
        mem,
        { ...NO_DECISION, wanted: true },
      )
      const stateDue = nowSec - mem.lastStateWriteSec >= GW_STATE_WRITE_SEC
      if (stateDue) mem.lastStateWriteSec = nowSec
      stmts.push(
        ...liveWriteStatements(
          this.env.DB,
          term.linkId,
          nowSec,
          {
            bar: decision.barDue,
            stateDue,
            ...(decision.posChanged ? { positions: item.positions } : {}),
            sample: samples.at(-1) ?? mem.lastSample ?? undefined,
          },
          { vps: att.vps },
        ),
      )
    }
    if (stale) this.syncWatch(nowMs)
    if (stmts.length > 0) await this.withDb((db) => db.batch(stmts))
  }

  private async gwEvent(
    ws: WebSocket,
    msg: Extract<GwClientMessage, { t: 'event' }>,
    nowMs: number,
  ): Promise<void> {
    const att = this.readGw(ws)
    const term = att ? this.loadTerms(att.connId).find((t) => t.tid === msg.tid) : undefined
    if (!att || !term) return
    const stmts = eventStatements(this.env.DB, term.linkId, msg, Math.floor(nowMs / 1000), {
      eaVer: term.ea,
      vps: att.vps,
    })
    if (stmts.length > 0) {
      const done = await this.withDb((db) => db.batch(stmts))
      if (done === null) return // không ack: Gateway giữ hàng đợi và gửi lại khi nối lại
    }
    this.sendGw(ws, { t: 'ack', tid: msg.tid, seq: msg.seq })
  }

  /** Gateway rời: terminal đang online thành offline (ghi theo chuyển trạng thái). */
  private async markOffline(terms: GwTerm[]): Promise<void> {
    const nowSec = Math.floor(Date.now() / 1000)
    const stmts: D1PreparedStatement[] = []
    for (const t of terms) {
      if (t.online) {
        stmts.push(...presenceStatements(this.env.DB, t.linkId, false, undefined, nowSec, {}))
      }
    }
    if (stmts.length > 0) await this.withDb((db) => db.batch(stmts))
  }

  private sendSnapshot(ws: WebSocket, att: ConnAttachment, nowMs: number): void {
    const links: SnapshotLink[] = []
    for (const [linkId, mem] of this.links) {
      if (!scopeMatches(att.scope, { linkId, ownerId: mem.ownerId })) continue
      if (mem.lastSample === null && mem.positions === null) continue
      links.push({
        id: linkId,
        live_state: this.stateOf(mem, nowMs),
        sample: mem.lastSample,
        ...(mem.positions !== null ? { positions: mem.positions } : {}),
        ...(mem.posHash !== null ? { pos_hash: mem.posHash } : {}),
      })
    }
    const message: ServerMessage = {
      t: 'snapshot',
      server_time: Math.floor(nowMs / 1000),
      links,
    }
    try {
      ws.send(JSON.stringify(message))
    } catch {
      // đã đóng
    }
  }
}

/** `hello` phải khớp phạm vi mà Worker đã cấp lúc nâng cấp; không khớp thì đóng. */
function helloMatchesScope(
  scope: LiveScope,
  hello: Extract<ClientMessage, { t: 'hello' }>,
): boolean {
  if (scope.kind === 'link') return hello.scope === 'link' && hello.id === scope.linkId
  return hello.scope === 'links'
}
