import {
  ALERT,
  type AlertReportBody,
  type AlertSettings,
  bpToPct,
  DEFAULT_GROWTH_MODE,
  type GrowthMode,
  type MarkReadRequest,
  type NotificationData,
  type NotificationKind,
  type NotificationListResponse,
  type NotificationView,
  notificationDataSchema,
} from '@az-sentinel/shared'
import { type AlertContext, type AlertState, decideAlert, EMPTY_STATE } from './alert-logic'

// ---------------------------------------------------------------------------
// Cài đặt
// ---------------------------------------------------------------------------

type SettingRow = { loss_bp: number; growth_mode: GrowthMode }

/** Cài đặt cảnh báo của một người: ngưỡng (basis point; 0 = tắt hoặc chưa đặt) và cách tính "đã tăng X%". */
export async function loadAlertSettings(
  db: D1Database,
  ownerId: number,
): Promise<{ bp: number; mode: GrowthMode }> {
  const row = await db
    .prepare('SELECT loss_bp, growth_mode FROM alert_settings WHERE owner_id = ?')
    .bind(ownerId)
    .first<SettingRow>()
  return { bp: row?.loss_bp ?? 0, mode: row?.growth_mode ?? DEFAULT_GROWTH_MODE }
}

/** Ngưỡng cảnh báo (basis point) của một người; 0 = tắt hoặc chưa đặt. */
export async function loadAlertBp(db: D1Database, ownerId: number): Promise<number> {
  return (await loadAlertSettings(db, ownerId)).bp
}

export function toSettingsView(s: { bp: number; mode: GrowthMode }): AlertSettings {
  return { loss_pct: bpToPct(s.bp), growth_mode: s.mode }
}

export async function saveAlertSettings(
  db: D1Database,
  ownerId: number,
  bp: number,
  mode: GrowthMode,
  now: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO alert_settings (owner_id, loss_bp, growth_mode, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(owner_id) DO UPDATE SET loss_bp = excluded.loss_bp, growth_mode = excluded.growth_mode,
         updated_at = excluded.updated_at`,
    )
    .bind(ownerId, bp, mode, now)
    .run()
}

// ---------------------------------------------------------------------------
// Báo cáo từ EA
// ---------------------------------------------------------------------------

type StateRow = {
  episode_open: number
  ep_started_at: number | null
  last_notified_at: number | null
  last_notified_fl: number | null
  last_aseq: number
}

export type AlertTerm = {
  linkId: number
  ownerId: number
  /** `<login>@<server>` */
  tid: string
}

function contextOf(tid: string): AlertContext {
  const at = tid.indexOf('@')
  const login = at > 0 ? Number(tid.slice(0, at)) : Number.NaN
  return {
    login: Number.isInteger(login) && login > 0 ? login : null,
    server: at > 0 ? tid.slice(at + 1) : null,
  }
}

/**
 * Xử lý một báo cáo cảnh báo của EA (đã qua Gateway). Đọc ngưỡng của chủ liên kết và trạng thái đợt hiện tại,
 * hỏi `decideAlert`, và nếu cần báo thì ghi (một `batch`): trạng thái đợt + thông báo + dọn thông báo cũ.
 * Idempotent: gửi lại cùng báo cáo không tạo thông báo thứ hai. Trả loại thông báo đã tạo (hoặc null).
 */
export async function processAlertReport(
  db: D1Database,
  term: AlertTerm,
  report: AlertReportBody,
  now: number,
): Promise<NotificationKind | null> {
  const [cfg, row] = await Promise.all([
    loadAlertSettings(db, term.ownerId),
    db
      .prepare(
        `SELECT episode_open, ep_started_at, last_notified_at, last_notified_fl, last_aseq
         FROM alert_state WHERE link_id = ?`,
      )
      .bind(term.linkId)
      .first<StateRow>(),
  ])
  const state: AlertState = row
    ? { ...row, episode_open: row.episode_open === 1 ? 1 : 0 }
    : EMPTY_STATE
  const decision = decideAlert(report, state, cfg.bp, now, contextOf(term.tid), cfg.mode)
  if (decision.notify === null) return null

  const { notify, state: next } = decision
  await db.batch([
    db
      .prepare(
        `INSERT INTO alert_state
           (link_id, episode_open, ep_started_at, last_notified_at, last_notified_fl, last_aseq, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(link_id) DO UPDATE SET
           episode_open = excluded.episode_open, ep_started_at = excluded.ep_started_at,
           last_notified_at = excluded.last_notified_at, last_notified_fl = excluded.last_notified_fl,
           last_aseq = excluded.last_aseq, updated_at = excluded.updated_at`,
      )
      .bind(
        term.linkId,
        next.episode_open,
        next.ep_started_at,
        next.last_notified_at,
        next.last_notified_fl,
        next.last_aseq,
        now,
      ),
    db
      .prepare(
        `INSERT INTO notifications
           (uid, owner_id, link_id, kind, title, body, data_json, created_at, read_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        term.ownerId,
        term.linkId,
        notify.kind,
        notify.title,
        notify.body,
        JSON.stringify(notify.data),
        now,
        now,
      ),
    ...pruneStatements(db, term.ownerId, now),
  ])
  return notify.kind
}

/** Dọn thông báo quá hạn hoặc quá số lượng của một người (cùng luật ở VPS và Cloudflare nên hai bên hội tụ). */
export function pruneStatements(
  db: D1Database,
  ownerId: number,
  now: number,
): D1PreparedStatement[] {
  return [
    db
      .prepare('DELETE FROM notifications WHERE owner_id = ? AND created_at < ?')
      .bind(ownerId, now - ALERT.keepDays * 86400),
    db
      .prepare(
        `DELETE FROM notifications WHERE owner_id = ? AND id NOT IN (
           SELECT id FROM notifications WHERE owner_id = ? ORDER BY created_at DESC, id DESC LIMIT ?)`,
      )
      .bind(ownerId, ownerId, ALERT.keepPerOwner),
  ]
}

// ---------------------------------------------------------------------------
// Giao diện
// ---------------------------------------------------------------------------

type NotificationRow = {
  uid: string
  link_id: number | null
  kind: NotificationKind
  title: string
  body: string
  data_json: string | null
  created_at: number
  read_at: number | null
}

function parseData(json: string | null): NotificationData {
  if (!json) return {}
  try {
    const parsed = notificationDataSchema.safeParse(JSON.parse(json))
    return parsed.success ? parsed.data : {}
  } catch {
    return {}
  }
}

export function toView(r: NotificationRow): NotificationView {
  return {
    id: r.uid,
    kind: r.kind,
    title: r.title,
    body: r.body,
    link_id: r.link_id,
    created_at: r.created_at,
    read: r.read_at !== null,
    data: parseData(r.data_json),
  }
}

export async function unreadCount(db: D1Database, ownerId: number): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM notifications WHERE owner_id = ? AND read_at IS NULL')
    .bind(ownerId)
    .first<{ n: number }>()
  return row?.n ?? 0
}

export async function listNotifications(
  db: D1Database,
  ownerId: number,
  opts: { limit: number; unreadOnly: boolean },
): Promise<NotificationListResponse> {
  const { results } = await db
    .prepare(
      `SELECT uid, link_id, kind, title, body, data_json, created_at, read_at
       FROM notifications
       WHERE owner_id = ? ${opts.unreadOnly ? 'AND read_at IS NULL' : ''}
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .bind(ownerId, opts.limit)
    .all<NotificationRow>()
  return { items: results.map(toView), unread: await unreadCount(db, ownerId) }
}

/** Đánh dấu đã đọc (chỉ thông báo của chính người đó). Trả số dòng vừa đổi sang đã đọc. */
export async function markRead(
  db: D1Database,
  ownerId: number,
  req: MarkReadRequest,
  now: number,
): Promise<number> {
  const stmt =
    'all' in req
      ? db
          .prepare(
            'UPDATE notifications SET read_at = ?, updated_at = ? WHERE owner_id = ? AND read_at IS NULL',
          )
          .bind(now, now, ownerId)
      : db
          .prepare(
            `UPDATE notifications SET read_at = ?, updated_at = ?
             WHERE owner_id = ? AND read_at IS NULL AND uid IN (${req.ids.map(() => '?').join(', ')})`,
          )
          .bind(now, now, ownerId, ...req.ids)
  const res = await stmt.run()
  return res.meta.changes ?? 0
}
