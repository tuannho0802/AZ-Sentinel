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
  /** Chủ sở hữu; null ở chế độ dev (liên kết tạo qua /api/dev chưa có chủ). */
  owner_id: number | null
  /** Giờ nhận gần nhất; làm "đồng hồ" cho ghi điều tiết (Plan 3B mục 7). null = chưa có. */
  last_seen_at: number | null
}

/** Đọc ~3 dòng (chỉ mục key_hash -> ea_links -> link_state). Ghi 0. */
export function findLinkByKeyHash(db: D1Database, keyHash: string): Promise<LinkRow | null> {
  return db
    .prepare(
      `SELECT l.id, l.status, l.login, l.server, l.owner_id,
              s.last_sid, s.last_seq, s.presence, s.last_seen_at
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

/**
 * Ghi 1 dòng (upsert theo khóa chính, không chỉ mục phụ).
 * `positions` vắng mặt (undefined) thì giữ nguyên `positions_json` đang lưu; có mặt (kể cả mảng
 * rỗng) thì thay bằng danh sách mới.
 */
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
         positions_json = COALESCE(excluded.positions_json, link_state.positions_json),
         pending_json = excluded.pending_json,
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
      p.positions === undefined ? null : JSON.stringify(p.positions),
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

/**
 * Nến M5 bù từ EA (reason `backfill`). Ghi 0-1 dòng mỗi nến (INSERT OR IGNORE trên bảng
 * WITHOUT ROWID, không chỉ mục phụ); nến đã có thì bỏ qua, không ghi đè.
 */
export function insertEquityBarStmt(
  db: D1Database,
  linkId: number,
  barTs: number,
  bar: { bal: number; eq: number; fl: number; ml?: number | null },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT OR IGNORE INTO equity_m5 (link_id, ts, balance, equity, floating_pl, margin_level)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(linkId, barTs, bar.bal, bar.eq, bar.fl, bar.ml ?? null)
}

/**
 * Gate: đánh dấu EA còn sống. Chỉ có tác dụng khi đã có dòng link_state; service gọi tối đa
 * một lần mỗi 240 giây (hoặc khi presence = 1). Ghi 0-1 dòng.
 */
export function touchLinkSeenStmt(
  db: D1Database,
  linkId: number,
  now: number,
): D1PreparedStatement {
  return db
    .prepare('UPDATE link_state SET last_seen_at = ?, presence = 0 WHERE link_id = ?')
    .bind(now, linkId)
}

/** Chủ sở hữu của một liên kết, để kiểm quyền xem (Plan 3B mục 7, quy tắc 6). Đọc 1 dòng. */
export function findLinkOwner(
  db: D1Database,
  linkId: number,
): Promise<{ owner_id: number | null } | null> {
  return db
    .prepare('SELECT owner_id FROM ea_links WHERE id = ?')
    .bind(linkId)
    .first<{ owner_id: number | null }>()
}

// ---------------------------------------------------------------------------
// Đường Gateway (Plan 3C, patch 08)
// ---------------------------------------------------------------------------

/** Ảnh chụp tài khoản gọn (từ `state`, `event` hoặc mẫu `batch`). */
export type SnapLike = {
  bal: number
  eq: number
  fl: number
  ml?: number | null | undefined
  margin?: number | undefined
}

/** Gắn khóa với tài khoản lần đầu theo `bind` của Gateway. Ghi 1 dòng, chỉ khi login còn null. */
export function bindLinkAccountStmt(
  db: D1Database,
  linkId: number,
  a: {
    login: number
    server: string
    mode: string
    broker?: string
    name?: string
  },
  now: number,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE ea_links
       SET login = ?, server = ?, broker = ?, name = ?, mode = ?, bound_at = ?
       WHERE id = ? AND login IS NULL`,
    )
    .bind(a.login, a.server, a.broker ?? null, a.name ?? null, a.mode, now, linkId)
}

/**
 * Sự kiện online/offline CHỈ chèn khi chuyển trạng thái so với `presence` đang lưu (so sánh ngay
 * trong SQL nên `state` lặp lại không ghi gì). Phải chạy TRƯỚC câu cập nhật presence trong batch.
 * Chưa có dòng link_state coi như đang offline. Ghi 0 hoặc 2 dòng (bảng + chỉ mục).
 */
export function insertPresenceEventStmt(
  db: D1Database,
  linkId: number,
  now: number,
  type: 'online' | 'offline',
): D1PreparedStatement {
  const cond =
    type === 'online'
      ? 'COALESCE((SELECT presence FROM link_state WHERE link_id = ?), 1) = 1'
      : 'COALESCE((SELECT presence FROM link_state WHERE link_id = ?), 1) = 0'
  return db
    .prepare(
      `INSERT INTO events (link_id, ts, type, detail_json)
       SELECT ?, ?, '${type}', NULL WHERE ${cond}`,
    )
    .bind(linkId, now, linkId)
}

/** Chỉ đổi `presence`. Online thì cập nhật luôn last_seen_at; offline giữ mốc cuối cùng thấy. */
export function setPresenceStmt(
  db: D1Database,
  linkId: number,
  presence: 0 | 1,
  now: number,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE link_state
       SET presence = ?, last_seen_at = CASE WHEN ? = 0 THEN ? ELSE last_seen_at END
       WHERE link_id = ?`,
    )
    .bind(presence, presence, now, linkId)
}

/** Ghi 1 dòng link_state từ ảnh chụp gọn. Không đụng last_sid/last_seq/positions_json. */
export function upsertSnapStateStmt(
  db: D1Database,
  linkId: number,
  s: SnapLike,
  now: number,
  o: { presence: 0 | 1; reason: string; eaVer?: string; vps?: string },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO link_state (
         link_id, balance, equity, margin, margin_level, floating_pl,
         last_reason, last_seen_at, ea_ver, vps_label, presence
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (link_id) DO UPDATE SET
         balance = excluded.balance, equity = excluded.equity,
         margin = COALESCE(excluded.margin, link_state.margin),
         margin_level = excluded.margin_level, floating_pl = excluded.floating_pl,
         last_reason = excluded.last_reason, last_seen_at = excluded.last_seen_at,
         ea_ver = COALESCE(excluded.ea_ver, link_state.ea_ver),
         vps_label = COALESCE(excluded.vps_label, link_state.vps_label),
         presence = excluded.presence`,
    )
    .bind(
      linkId,
      s.bal,
      s.eq,
      s.margin ?? null,
      s.ml ?? null,
      s.fl,
      o.reason,
      now,
      o.eaVer ?? null,
      o.vps ?? null,
      o.presence,
    )
}

/** Sự kiện `risk` (margin level thấp) mà EA báo qua `event`. Ghi 2 dòng. */
export function insertRiskEventStmt(
  db: D1Database,
  linkId: number,
  now: number,
  d: { ml: number | null; eq: number | null },
): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO events (link_id, ts, type, detail_json) VALUES (?, ?, 'risk', ?)`)
    .bind(linkId, now, JSON.stringify(d))
}

/** Thay danh sách vị thế đã lưu. Ghi 1 dòng. Không tạo dòng mới (link_state đã có từ `state`). */
export function setPositionsStmt(
  db: D1Database,
  linkId: number,
  json: string,
): D1PreparedStatement {
  return db.prepare('UPDATE link_state SET positions_json = ? WHERE link_id = ?').bind(json, linkId)
}
