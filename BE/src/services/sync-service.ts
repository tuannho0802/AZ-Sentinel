import type { SyncApply, SyncLinkRow, SyncTokenRow, SyncTradeRow } from '@az-sentinel/shared'

export const LINK_COLS = [
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

export const TRADE_COLS = [
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

export const TOKEN_COLS = [
  'id',
  'owner_id',
  'label',
  'token_hash',
  'token_prefix',
  'status',
  'created_at',
  'revoked_at',
] as const satisfies readonly (keyof SyncTokenRow)[]

const placeholders = (n: number) => Array(n).fill('?').join(', ')

const LINK_UPSERT = `INSERT INTO ea_links (${LINK_COLS.join(', ')}) VALUES (${placeholders(LINK_COLS.length)})
  ON CONFLICT(id) DO UPDATE SET ${LINK_COLS.filter((c) => c !== 'id')
    .map((c) => `${c} = excluded.${c}`)
    .join(', ')}`

/** `last_used_at` không nằm trong TOKEN_COLS nên upsert không bao giờ ghi đè nó. */
const TOKEN_UPSERT = `INSERT INTO gw_tokens (${TOKEN_COLS.join(', ')}) VALUES (${placeholders(TOKEN_COLS.length)})
  ON CONFLICT(id) DO UPDATE SET ${TOKEN_COLS.filter((c) => c !== 'id')
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
    stmts.push(
      db.prepare('DELETE FROM trades WHERE link_id = ? AND ticket = ?').bind(t.link_id, t.ticket),
    )
  }
  for (const row of payload.tokens) {
    // Mỗi người một token đang hoạt động: token cũ cùng chủ (id khác) bị thu hồi trước khi upsert dòng mới,
    // và dòng khác đang giữ cùng băm bị xóa để không vướng ràng buộc duy nhất.
    if (row.status === 'active') {
      stmts.push(
        db
          .prepare(
            `UPDATE gw_tokens SET status = 'revoked', revoked_at = ?
             WHERE owner_id = ? AND status = 'active' AND id <> ?`,
          )
          .bind(row.created_at, row.owner_id, row.id),
      )
    }
    stmts.push(
      db
        .prepare('DELETE FROM gw_tokens WHERE token_hash = ? AND id <> ?')
        .bind(row.token_hash, row.id),
    )
    stmts.push(db.prepare(TOKEN_UPSERT).bind(...TOKEN_COLS.map((c) => row[c])))
  }
  for (const row of payload.links) {
    stmts.push(db.prepare(LINK_UPSERT).bind(...LINK_COLS.map((c) => row[c])))
  }
  for (const row of payload.trades) {
    stmts.push(db.prepare(TRADE_UPSERT).bind(...TRADE_COLS.map((c) => row[c])))
  }
  if (stmts.length === 0) return 0
  await db.batch(stmts)
  return (
    payload.links.length +
    payload.links_deleted.length +
    payload.tokens.length +
    payload.trades.length +
    payload.trades_deleted.length
  )
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
  return {
    trades: page,
    next: more && last ? { link_id: last.link_id, ticket: last.ticket } : null,
  }
}
/** Một trang `ea_links` theo `id` tăng dần (VPS kéo lần khởi động đầu). `next` = id cuối nếu còn trang sau. */
export async function readLinksAfter(
  db: D1Database,
  after: number,
  limit: number,
): Promise<{ links: SyncLinkRow[]; next: number | null }> {
  const { results } = await db
    .prepare(`SELECT ${LINK_COLS.join(', ')} FROM ea_links WHERE id > ? ORDER BY id LIMIT ?`)
    .bind(after, limit + 1)
    .all<SyncLinkRow>()
  const more = results.length > limit
  const page = more ? results.slice(0, limit) : results
  const last = page.at(-1)
  return { links: page, next: more && last ? last.id : null }
}

/** Một trang `gw_tokens` theo `id` tăng dần (VPS kéo lần khởi động đầu, và CF nhận lại sau khi sống lại). */
export async function readTokensAfter(
  db: D1Database,
  after: number,
  limit: number,
): Promise<{ tokens: SyncTokenRow[]; next: number | null }> {
  const { results } = await db
    .prepare(`SELECT ${TOKEN_COLS.join(', ')} FROM gw_tokens WHERE id > ? ORDER BY id LIMIT ?`)
    .bind(after, limit + 1)
    .all<SyncTokenRow>()
  const more = results.length > limit
  const page = more ? results.slice(0, limit) : results
  const last = page.at(-1)
  return { tokens: page, next: more && last ? last.id : null }
}
