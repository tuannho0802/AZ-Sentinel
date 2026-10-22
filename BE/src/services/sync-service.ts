import type { SyncApply, SyncLinkRow, SyncTradeRow } from '@az-sentinel/shared'

const LINK_COLS = [
    'id',
    'owner_id',
    'login',
    'server',
    'broker',
    'name',
    'currency',
    'mode',
    'key_hash',
    'key_prefix',
    'status',
    'bound_at',
    'created_at',
    'vps_name',
] as const satisfies readonly (keyof SyncLinkRow)[]

const TRADE_COLS = [
    'link_id',
    'ticket',
    'symbol',
    'type',
    'volume',
    'open_time',
    'open_price',
    'close_time',
    'close_price',
    'sl',
    'tp',
    'profit',
    'swap',
    'commission',
    'comment',
    'magic',
] as const satisfies readonly (keyof SyncTradeRow)[]

const placeholders = (n: number) => Array(n).fill('?').join(', ')

const LINK_UPSERT = `INSERT INTO ea_links (${LINK_COLS.join(', ')}) VALUES (${placeholders(LINK_COLS.length)})
  ON CONFLICT(id) DO UPDATE SET ${LINK_COLS.filter((c) => c !== 'id')
        .map((c) => `${c} = excluded.${c}`)
        .join(', ')}`

const TRADE_UPSERT = `INSERT INTO trades (${TRADE_COLS.join(', ')}) VALUES (${placeholders(TRADE_COLS.length)})
  ON CONFLICT(link_id, ticket) DO UPDATE SET ${TRADE_COLS.filter(
    (c) => c !== 'link_id' && c !== 'ticket',
)
        .map((c) => `${c} = excluded.${c}`)
        .join(', ')}`

/**
 * Áp một lô thay đổi từ VPS vào D1 (Plan 3E). Chỉ dùng câu lệnh cố định, tham số hóa; VPS không gửi
 * SQL. Xóa chạy trước upsert để một (server, login) được giao lại cho liên kết khác không vướng
 * ràng buộc duy nhất. Tất cả trong một `batch` (nguyên tử). Trả số dòng đã đụng tới.
 */
export async function applySync(db: D1Database, payload: SyncApply): Promise<number> {
    const stmts: D1PreparedStatement[] = []
    for (const id of payload.links_deleted) {
        for (const table of ['link_state', 'equity_m5', 'trades', 'events']) {
            stmts.push(db.prepare(`DELETE FROM ${table} WHERE link_id = ?`).bind(id))
        }
        stmts.push(db.prepare('DELETE FROM ea_links WHERE id = ?').bind(id))
    }
    for (const t of payload.trades_deleted) {
        stmts.push(db.prepare('DELETE FROM trades WHERE link_id = ? AND ticket = ?').bind(t.link_id, t.ticket))
    }
    for (const row of payload.links) {
        stmts.push(db.prepare(LINK_UPSERT).bind(...LINK_COLS.map((c) => row[c])))
    }
    for (const row of payload.trades) {
        stmts.push(db.prepare(TRADE_UPSERT).bind(...TRADE_COLS.map((c) => row[c])))
    }
    if (stmts.length === 0) return 0
    await db.batch(stmts)
    return payload.links.length + payload.links_deleted.length + payload.trades.length + payload.trades_deleted.length
}

export type TradesCursor = { link_id: number; ticket: number }

/**
 * Các lệnh Cloudflare đã ghi từ mốc `since` (Unix giây) mà VPS có thể chưa có: đang mở, hoặc mở/đóng
 * sau `since`. Phân trang theo khóa chính `(link_id, ticket)` để không phụ thuộc OFFSET.
 */
export async function readTradesSince(
    db: D1Database,
    since: number,
    after: TradesCursor,
    limit: number,
): Promise<{ trades: SyncTradeRow[]; next: TradesCursor | null }> {
    const { results } = await db
        .prepare(
            `SELECT ${TRADE_COLS.join(', ')} FROM trades
       WHERE (link_id > ? OR (link_id = ? AND ticket > ?))
         AND (close_time IS NULL OR close_time >= ? OR open_time >= ?)
       ORDER BY link_id, ticket LIMIT ?`,
        )
        .bind(after.link_id, after.link_id, after.ticket, since, since, limit + 1)
        .all<SyncTradeRow>()
    const more = results.length > limit
    const page = more ? results.slice(0, limit) : results
    const last = page.at(-1)
    return { trades: page, next: more && last ? { link_id: last.link_id, ticket: last.ticket } : null }
}