import type {
  SyncAlertSettingRow,
  SyncAlertStateRow,
  SyncApply,
  SyncLinkRow,
  SyncNotificationRow,
  SyncTokenRow,
  SyncTradeRow,
  SyncUserRow,
} from '@az-sentinel/shared'
import { pruneStatements } from './alert-service'

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

export const USER_COLS = [
  'id',
  'email',
  'display_name',
  'password_hash',
  'role',
  'status',
  'created_at',
] as const satisfies readonly (keyof SyncUserRow)[]

export const ALERT_SETTING_COLS = [
  'owner_id',
  'loss_bp',
  'updated_at',
] as const satisfies readonly (keyof SyncAlertSettingRow)[]

export const ALERT_STATE_COLS = [
  'link_id',
  'episode_open',
  'ep_started_at',
  'last_notified_at',
  'last_notified_fl',
  'last_aseq',
  'updated_at',
] as const satisfies readonly (keyof SyncAlertStateRow)[]

export const NOTIFICATION_COLS = [
  'uid',
  'owner_id',
  'link_id',
  'kind',
  'title',
  'body',
  'data_json',
  'created_at',
  'read_at',
  'updated_at',
] as const satisfies readonly (keyof SyncNotificationRow)[]

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

/** `failed_logins`/`locked_until` không nằm trong USER_COLS nên upsert không bao giờ ghi đè chúng. */
const USER_UPSERT = `INSERT INTO users (${USER_COLS.join(', ')}) VALUES (${placeholders(USER_COLS.length)})
  ON CONFLICT(id) DO UPDATE SET ${USER_COLS.filter((c) => c !== 'id')
    .map((c) => `${c} = excluded.${c}`)
    .join(', ')}`

/** Cài đặt cảnh báo chỉ được sửa ở VPS (chế độ dự phòng chặn ghi), nên VPS ghi đè. */
const ALERT_SETTING_UPSERT = `INSERT INTO alert_settings (${ALERT_SETTING_COLS.join(', ')}) VALUES (${placeholders(ALERT_SETTING_COLS.length)})
  ON CONFLICT(owner_id) DO UPDATE SET ${ALERT_SETTING_COLS.filter((c) => c !== 'owner_id')
    .map((c) => `${c} = excluded.${c}`)
    .join(', ')}`

/** Trạng thái đợt cảnh báo: bản mới hơn (theo `updated_at`) thắng, để hai nơi cùng ghi không lùi trạng thái. */
export const ALERT_STATE_UPSERT = `INSERT INTO alert_state (${ALERT_STATE_COLS.join(', ')}) VALUES (${placeholders(ALERT_STATE_COLS.length)})
  ON CONFLICT(link_id) DO UPDATE SET ${ALERT_STATE_COLS.filter((c) => c !== 'link_id')
    .map((c) => `${c} = excluded.${c}`)
    .join(', ')}
  WHERE excluded.updated_at >= alert_state.updated_at`

/**
 * Thông báo: nội dung bất biến theo `uid`; chỉ trạng thái đã đọc đi một chiều (đã đọc ở đâu thì đọc ở cả hai).
 * Cột `id` tự tăng của từng DB không đồng bộ.
 */
export const NOTIFICATION_UPSERT = `INSERT INTO notifications (${NOTIFICATION_COLS.join(', ')}) VALUES (${placeholders(NOTIFICATION_COLS.length)})
  ON CONFLICT(uid) DO UPDATE SET
    read_at = CASE
      WHEN notifications.read_at IS NULL THEN excluded.read_at
      WHEN excluded.read_at IS NULL THEN notifications.read_at
      ELSE MAX(notifications.read_at, excluded.read_at) END,
    updated_at = MAX(notifications.updated_at, excluded.updated_at)`

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
  for (const row of payload.users) {
    // VPS là nguồn gốc: dòng khác đang giữ cùng email bị xóa để không vướng ràng buộc duy nhất.
    stmts.push(db.prepare('DELETE FROM users WHERE email = ? AND id <> ?').bind(row.email, row.id))
    stmts.push(db.prepare(USER_UPSERT).bind(...USER_COLS.map((c) => row[c])))
    // Khóa/từ chối/đổi mật khẩu ở VPS thì phiên đang mở trên Cloudflare cũng hết hiệu lực.
    if (row.status !== 'active') {
      stmts.push(db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(row.id))
    }
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
  for (const row of payload.alert_settings) {
    stmts.push(db.prepare(ALERT_SETTING_UPSERT).bind(...ALERT_SETTING_COLS.map((c) => row[c])))
  }
  for (const row of payload.alert_states) {
    stmts.push(db.prepare(ALERT_STATE_UPSERT).bind(...ALERT_STATE_COLS.map((c) => row[c])))
  }
  const owners = new Set<number>()
  for (const row of payload.notifications) {
    stmts.push(db.prepare(NOTIFICATION_UPSERT).bind(...NOTIFICATION_COLS.map((c) => row[c])))
    owners.add(row.owner_id)
  }
  const nowSec = Math.floor(Date.now() / 1000)
  for (const owner of owners) stmts.push(...pruneStatements(db, owner, nowSec))
  if (stmts.length === 0) return 0
  await db.batch(stmts)
  return (
    payload.alert_settings.length +
    payload.alert_states.length +
    payload.notifications.length +
    payload.users.length +
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

/**
 * Thông báo mà Cloudflare đã ghi hoặc đổi từ mốc `since` (Unix giây), VPS kéo về sau khi sống lại. Phân trang theo
 * `id` cục bộ của Cloudflare (`after`) để không phụ thuộc OFFSET.
 */
export async function readNotificationsSince(
  db: D1Database,
  since: number,
  after: number,
  limit: number,
): Promise<{ notifications: SyncNotificationRow[]; next: number | null }> {
  const { results } = await db
    .prepare(
      `SELECT id, ${NOTIFICATION_COLS.join(', ')} FROM notifications
       WHERE id > ? AND updated_at >= ? ORDER BY id LIMIT ?`,
    )
    .bind(after, since, limit + 1)
    .all<SyncNotificationRow & { id: number }>()
  const more = results.length > limit
  const page = more ? results.slice(0, limit) : results
  const last = page.at(-1)
  return {
    notifications: page.map(({ id: _id, ...row }) => row),
    next: more && last ? last.id : null,
  }
}

/** Trạng thái đợt cảnh báo đổi từ mốc `since`. Bảng nhỏ (một dòng mỗi liên kết) nên không phân trang. */
export async function readAlertStatesSince(
  db: D1Database,
  since: number,
): Promise<{ states: SyncAlertStateRow[] }> {
  const { results } = await db
    .prepare(
      `SELECT ${ALERT_STATE_COLS.join(', ')} FROM alert_state WHERE updated_at >= ? ORDER BY link_id LIMIT 1000`,
    )
    .bind(since)
    .all<SyncAlertStateRow>()
  return { states: results }
}
