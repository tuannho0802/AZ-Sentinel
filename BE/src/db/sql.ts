import type { Account, IngestPayload, TradeEvent } from '@az-sentinel/shared'

/**
 * SQL thô cho đường ingest (Rules BE mục 6). Mỗi hàm ghi chú số dòng đọc/ghi dự kiến.
 * Mọi giá trị đi qua bind(); không ghép chuỗi từ dữ liệu người dùng.
 * "Dòng ghi" theo D1 gồm cả dòng chỉ mục: bảng nóng không có chỉ mục phụ nên mỗi upsert = 1.
 */

export type LinkRow = {
  id: number
  status: string
  login: number | null
  server: string | null
  last_sid: string | null
  last_seq: number | null
  presence: number | null
}

/** Đọc ~3 dòng (chỉ mục key_hash -> ea_links -> link_state). Ghi 0. */
export function findLinkByKeyHash(db: D1Database, keyHash: string): Promise<LinkRow | null> {
  return db
    .prepare(
      `SELECT l.id, l.status, l.login, l.server, s.last_sid, s.last_seq, s.presence
       FROM ea_links l LEFT JOIN link_state s ON s.link_id = l.id
       WHERE l.key_hash = ?`,
    )
    .bind(keyHash)
    .first<LinkRow>()
}

/** Gắn khóa với (server, login) lần đầu. Chỉ chạy một lần mỗi liên kết (cột login còn null). */
export function bindLinkStmt(
  db: D1Database,
  linkId: number,
  a: Account,
  now: number,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE ea_links
       SET login = ?, server = ?, broker = ?, name = ?, currency = ?, mode = ?, bound_at = ?
       WHERE id = ? AND login IS NULL`,
    )
    .bind(
      a.login,
      a.server,
      a.broker ?? null,
      a.name ?? null,
      a.currency ?? null,
      a.mode ?? null,
      now,
      linkId,
    )
}

export type LinkStateInput = {
  linkId: number
  payload: IngestPayload
  vpsLabel: string | null
  ip: string | null
  now: number
}

/** Ghi 1 dòng (upsert theo khóa chính, không chỉ mục phụ). */
export function upsertLinkStateStmt(db: D1Database, i: LinkStateInput): D1PreparedStatement {
  const { payload: p, now } = i
  const a = p.account
  return db
    .prepare(
      `INSERT INTO link_state (
         link_id, balance, equity, margin, margin_free, margin_level, floating_pl,
         positions_json, pending_json, last_reason,
         last_seen_at, last_seq, last_sid, ea_ver, last_ip, vps_label, presence
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT (link_id) DO UPDATE SET
         balance = excluded.balance, equity = excluded.equity, margin = excluded.margin,
         margin_free = excluded.margin_free, margin_level = excluded.margin_level,
         floating_pl = excluded.floating_pl,
         positions_json = excluded.positions_json, pending_json = excluded.pending_json,
         last_reason = excluded.last_reason,
         last_seen_at = excluded.last_seen_at, last_seq = excluded.last_seq,
         last_sid = excluded.last_sid, ea_ver = excluded.ea_ver, last_ip = excluded.last_ip,
         vps_label = excluded.vps_label, presence = 0`,
    )
    .bind(
      i.linkId,
      a.balance,
      a.equity,
      a.margin ?? null,
      a.margin_free ?? null,
      a.margin_level ?? null,
      a.floating_pl,
      JSON.stringify(p.positions),
      p.pending ? JSON.stringify(p.pending) : null,
      p.reason.join(','),
      now,
      p.seq,
      p.sid,
      p.ea_ver ?? null,
      i.ip,
      i.vpsLabel,
    )
}

/** Ghi 0-1 dòng (INSERT OR IGNORE; WITHOUT ROWID nên không có chỉ mục ẩn). */
export function insertEquityM5Stmt(
  db: D1Database,
  linkId: number,
  barTs: number,
  a: Account,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT OR IGNORE INTO equity_m5 (link_id, ts, balance, equity, floating_pl, margin_level)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(linkId, barTs, a.balance, a.equity, a.floating_pl, a.margin_level ?? null)
}

/**
 * Upsert một dòng trades theo (link_id, ticket = position_id): idempotent khi gửi lại và
 * không phụ thuộc thứ tự open/close. Cột nhận dạng (symbol, type, volume, open_*) giữ giá
 * trị cũ nếu đã có; cột kết quả (close_*, sl, tp, profit, ...) lấy giá trị mới không null.
 * Ghi 1 dòng.
 */
export function upsertTradeStmt(
  db: D1Database,
  linkId: number,
  e: TradeEvent,
): D1PreparedStatement {
  const isOpen = e.kind === 'open'
  const isClose = e.kind === 'close'
  return db
    .prepare(
      `INSERT INTO trades (
         link_id, ticket, symbol, type, volume, open_time, open_price, close_time, close_price,
         sl, tp, profit, swap, commission, comment, magic
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (link_id, ticket) DO UPDATE SET
         symbol = COALESCE(trades.symbol, excluded.symbol),
         type = COALESCE(trades.type, excluded.type),
         volume = COALESCE(trades.volume, excluded.volume),
         open_time = COALESCE(trades.open_time, excluded.open_time),
         open_price = COALESCE(trades.open_price, excluded.open_price),
         close_time = COALESCE(excluded.close_time, trades.close_time),
         close_price = COALESCE(excluded.close_price, trades.close_price),
         sl = COALESCE(excluded.sl, trades.sl),
         tp = COALESCE(excluded.tp, trades.tp),
         profit = COALESCE(excluded.profit, trades.profit),
         swap = COALESCE(excluded.swap, trades.swap),
         commission = COALESCE(excluded.commission, trades.commission),
         comment = COALESCE(trades.comment, excluded.comment),
         magic = COALESCE(trades.magic, excluded.magic)`,
    )
    .bind(
      linkId,
      e.position_id,
      e.symbol ?? null,
      e.type ?? null,
      e.volume ?? null,
      isOpen ? e.time : null,
      isOpen ? (e.price ?? null) : null,
      isClose ? e.time : null,
      isClose ? (e.price ?? null) : null,
      e.sl ?? null,
      e.tp ?? null,
      e.profit ?? null,
      e.swap ?? null,
      e.commission ?? null,
      e.comment ?? null,
      e.magic ?? null,
    )
}

/** Ghi 2 dòng (bảng + chỉ mục idx_events_link_ts). Chỉ khi chuyển offline -> online. */
export function insertOnlineEventStmt(
  db: D1Database,
  linkId: number,
  now: number,
): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO events (link_id, ts, type, detail_json) VALUES (?, ?, 'online', NULL)`)
    .bind(linkId, now)
}

export const AUTH_FAIL_THROTTLE_SECONDS = 300

/**
 * Ghi sự kiện auth_fail nhưng tối đa một lần mỗi 5 phút cho mỗi liên kết, để EA lỗi
 * không tự gây ghi dồn (Rules BE mục 9). Đọc theo chỉ mục (link_id, ts); ghi 0 hoặc 2 dòng.
 */
export function insertAuthFailEventStmt(
  db: D1Database,
  linkId: number,
  now: number,
  detail: Record<string, string | number>,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO events (link_id, ts, type, detail_json)
       SELECT ?, ?, 'auth_fail', ?
       WHERE NOT EXISTS (
         SELECT 1 FROM events WHERE link_id = ? AND type = 'auth_fail' AND ts > ?
       )`,
    )
    .bind(linkId, now, JSON.stringify(detail), linkId, now - AUTH_FAIL_THROTTLE_SECONDS)
}
