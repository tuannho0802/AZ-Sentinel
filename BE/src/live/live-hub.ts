import { DurableObject } from 'cloudflare:workers'
import {
    clientMessageSchema,
    type ClientMessage,
    type KickReason,
    LIVE,
    type LiveState,
    type Position,
    type Sample,
    type ServerMessage,
    type SnapshotLink,
} from '@az-sentinel/shared'
import { m5Slot } from '../lib/time'
import type { Bindings } from '../types'
import type {
    ConnAttachment,
    HubLinkRef,
    HubStats,
    LiveScope,
    PublishInput,
    PublishResult,
} from './hub-types'
import { scopeMatches } from './scope'
import { decodeViewer, VIEWER_HEADER } from './viewer-header'

const WS_OPEN = 1
const MAX_CLIENT_MESSAGE_CHARS = 512
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
 * - Hub không đọc D1 và không ghi storage: không tốn dòng ghi.
 * - Mọi mốc thời gian đi vào qua tham số `nowMs` do Worker truyền để test xác định được.
 */
export class LiveHub extends DurableObject<Bindings> {
    private links = new Map<number, LinkMemory>()
    private rpcCalls = 0

    // ---------------------------------------------------------------- WebSocket (trình duyệt)

    override async fetch(request: Request): Promise<Response> {
        this.rpcCalls += 1
        if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
            return new Response('Expected WebSocket', { status: 426 })
        }
        const viewer = decodeViewer(request.headers.get(VIEWER_HEADER))
        if (!viewer) return new Response('Bad viewer', { status: 400 })

        const mine = this.aliveConns(viewer.nowMs).filter((c) => c.att.userId === viewer.userId).length
        const pair = new WebSocketPair()
        const client = pair[0]
        const server = pair[1]
        this.ctx.acceptWebSocket(server)
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
        return new Response(null, { status: 101, webSocket: client })
    }

    override webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
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
            return
        }
        ws.serializeAttachment(att)
    }

    override webSocketClose(): void {
        // Không cần làm gì: getWebSockets() không còn trả kết nối đã đóng, nên viewer tự biến mất.
    }

    override webSocketError(ws: WebSocket): void {
        try {
            ws.close(1011, 'error')
        } catch {
            // đã đóng
        }
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

        const wasLive = this.stateOf(mem, nowMs) === 'live'
        mem.lastSid = input.sid
        mem.lastSeq = input.seq
        mem.lastIngestAt = nowMs
        mem.lastLiveAt = nowMs

        const fresh = input.samples.filter((s) => s.t > mem.lastT)
        const last = fresh.at(-1)
        if (last) {
            mem.lastT = last.t
            mem.lastSample = last
        }

        const slot = m5Slot(Math.floor(nowMs / 1000))
        decision.barDue = mem.lastBarSlot !== slot
        mem.lastBarSlot = slot

        if (input.positions !== undefined) {
            decision.posChanged = input.posHash === undefined || input.posHash !== mem.lastPosHash
            mem.lastPosHash = input.posHash ?? null
            mem.positions = input.positions
            mem.posHash = input.posHash ?? null
        }

        const serverTime = Math.floor(nowMs / 1000)
        const out: ServerMessage[] = []
        if (!wasLive) out.push({ t: 'live_state', id: ref.linkId, server_time: serverTime, state: 'live' })
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
        for (const message of out) this.broadcast(viewers, message)
        return decision
    }

    /** Đá mọi kết nối của một người dùng (đăng xuất, hết phiên). Trả số kết nối đã đá. */
    async kickUser(userId: number, reason: KickReason): Promise<number> {
        this.rpcCalls += 1
        let n = 0
        for (const ws of this.ctx.getWebSockets()) {
            const att = ws.deserializeAttachment() as ConnAttachment | null
            if (att?.userId === userId) {
                this.kick(ws, reason)
                n += 1
            }
        }
        return n
    }

    async stats(nowMs: number): Promise<HubStats> {
        return {
            viewers: this.aliveConns(nowMs).length,
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
        for (const ws of this.ctx.getWebSockets()) {
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
function helloMatchesScope(scope: LiveScope, hello: Extract<ClientMessage, { t: 'hello' }>): boolean {
    if (scope.kind === 'link') return hello.scope === 'link' && hello.id === scope.linkId
    return hello.scope === 'links'
}