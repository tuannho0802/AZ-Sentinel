import type { GwClientMessage, Position, Sample } from '@az-sentinel/shared'
import {
    bindLinkAccountStmt,
    findLinkByKeyHash,
    insertAuthFailEventStmt,
    insertEquityM5Stmt,
    insertPresenceEventStmt,
    insertRiskEventStmt,
    type LinkRow,
    setPositionsStmt,
    setPresenceStmt,
    upsertSnapStateStmt,
    upsertTradeStmt,
} from '../db/sql'
import { m5Slot } from '../lib/time'
import { isUniqueViolation } from './ingest-service'

type BindMsg = Extract<GwClientMessage, { t: 'bind' }>
type EventMsg = Extract<GwClientMessage, { t: 'event' }>

export type BindResult =
    | { ok: true; linkId: number; ownerId: number | null }
    | { ok: false; code: 401 | 403 | 409 }

/**
 * `bind` của Gateway (Plan 3C mục 4): tra khóa (đọc ~3 dòng), kiểm tra trạng thái và tài khoản,
 * gắn lần đầu nếu chưa gắn. Cùng luật với đường ingest cũ: 401 khóa sai, 403 bị khóa, 409 khóa
 * đã gắn tài khoản khác hoặc tài khoản đã thuộc khóa khác. Ghi: 0 dòng; 1 dòng khi gắn lần đầu;
 * tối đa 1 sự kiện auth_fail mỗi 5 phút khi 409.
 */
export async function bindTerminal(
    db: D1Database,
    msg: BindMsg,
    keyHash: string,
    now: number,
): Promise<BindResult> {
    const link: LinkRow | null = await findLinkByKeyHash(db, keyHash)
    if (!link) return { ok: false, code: 401 }
    if (link.status !== 'active') return { ok: false, code: 403 }

    const failAuth = async (reason: string): Promise<BindResult> => {
        try {
            await insertAuthFailEventStmt(db, link.id, now, {
                reason,
                server: msg.server,
                login: msg.login,
            }).run()
        } catch {
            // Ghi sự kiện chỉ là phụ; không che mất kết quả xác thực.
        }
        return { ok: false, code: 409 }
    }

    if (link.login !== null) {
        if (link.login !== msg.login || link.server !== msg.server) return failAuth('account_mismatch')
        return { ok: true, linkId: link.id, ownerId: link.owner_id }
    }
    try {
        await bindLinkAccountStmt(
            db,
            link.id,
            {
                login: msg.login,
                server: msg.server,
                mode: msg.mode,
                ...(msg.broker !== undefined ? { broker: msg.broker } : {}),
                ...(msg.name !== undefined ? { name: msg.name } : {}),
            },
            now,
        ).run()
    } catch (error) {
        if (isUniqueViolation(error)) return failAuth('bound_elsewhere')
        throw error
    }
    return { ok: true, linkId: link.id, ownerId: link.owner_id }
}

type Snap = NonNullable<EventMsg['snap']>

/**
 * `state`: chỉ gọi khi trạng thái đổi. Sự kiện online/offline chỉ chèn nếu presence đang ở trạng
 * thái kia, nên lặp lại không ghi gì thêm. Ghi: 2-3 dòng khi đổi, 0 khi lặp.
 */
export function presenceStatements(
    db: D1Database,
    linkId: number,
    online: boolean,
    snap: Snap | undefined,
    now: number,
    o: { eaVer?: string | null; vps?: string | null },
): D1PreparedStatement[] {
    const out = [insertPresenceEventStmt(db, linkId, now, online ? 'online' : 'offline')]
    if (snap) {
        out.push(
            upsertSnapStateStmt(db, linkId, snap, now, {
                presence: online ? 0 : 1,
                reason: online ? 'online' : 'offline',
                ...(o.eaVer ? { eaVer: o.eaVer } : {}),
                ...(o.vps ? { vps: o.vps } : {}),
            }),
        )
    } else {
        out.push(setPresenceStmt(db, linkId, online ? 0 : 1, now))
    }
    return out
}

/** `event`: mỗi sự kiện lệnh 1 dòng trades (upsert, idempotent); ảnh chụp tài khoản 1 dòng. */
export function eventStatements(
    db: D1Database,
    linkId: number,
    msg: EventMsg,
    now: number,
    o: { eaVer?: string | null; vps?: string | null },
): D1PreparedStatement[] {
    const out: D1PreparedStatement[] = []
    for (const e of msg.events) out.push(upsertTradeStmt(db, linkId, e))
    if (msg.snap) {
        // Có tin từ terminal tức là nó đang sống: nếu đang offline thì ghi sự kiện online trước.
        out.push(insertPresenceEventStmt(db, linkId, now, 'online'))
        out.push(
            upsertSnapStateStmt(db, linkId, msg.snap, now, {
                presence: 0,
                reason: msg.reason.join(','),
                ...(o.eaVer ? { eaVer: o.eaVer } : {}),
                ...(o.vps ? { vps: o.vps } : {}),
            }),
        )
    }
    if (msg.reason.includes('risk')) {
        out.push(
            insertRiskEventStmt(db, linkId, now, {
                ml: msg.snap?.ml ?? null,
                eq: msg.snap?.eq ?? null,
            }),
        )
    }
    return out
}

export type LiveWrite = {
    /** Vừa qua ranh giới nến M5: ghi nến. */
    bar: boolean
    /** Đến hạn ghi link_state (tối đa 1 lần mỗi 300 giây khi có người xem). */
    stateDue: boolean
    /** Có mặt khi cấu trúc danh sách lệnh đổi. */
    positions?: Position[] | undefined
    sample?: Sample | undefined
}

/** Ghi theo sự kiện cho `batch` có người xem (Plan 3C mục 5). Không có người xem thì không gọi. */
export function liveWriteStatements(
    db: D1Database,
    linkId: number,
    now: number,
    w: LiveWrite,
    o: { vps?: string | null },
): D1PreparedStatement[] {
    const out: D1PreparedStatement[] = []
    const s = w.sample
    if (s && w.stateDue) {
        out.push(
            upsertSnapStateStmt(db, linkId, s, now, {
                presence: 0,
                reason: 'live',
                ...(o.vps ? { vps: o.vps } : {}),
            }),
        )
    }
    if (s && w.bar) {
        out.push(
            insertEquityM5Stmt(db, linkId, m5Slot(now), {
                balance: s.bal,
                equity: s.eq,
                floating_pl: s.fl,
                margin_level: s.ml ?? null,
            } as Parameters<typeof insertEquityM5Stmt>[3]),
        )
    }
    if (w.positions !== undefined) out.push(setPositionsStmt(db, linkId, JSON.stringify(w.positions)))
    return out
}