import { GW_TOKEN_STATUSES, type GwTokenStatus, type GwTokenSummary } from '@az-sentinel/shared'
import { AppError } from '../lib/app-error'
import { generateGwToken, sha256Hex } from '../lib/crypto'
import { isUniqueViolation } from './ingest-service'

/** Dòng `gw_tokens`. Không bao giờ chứa token thô, chỉ băm SHA-256 và tiền tố nhận diện. */
export type GwTokenRow = {
  id: number
  owner_id: number
  label: string
  token_hash: string
  token_prefix: string
  status: GwTokenStatus
  created_at: number
  last_used_at: number | null
  revoked_at: number | null
}

/** Chỉ ghi `last_used_at` nhiều nhất mỗi chừng này giây (bảng lạnh, tiết kiệm dòng ghi D1). */
export const TOKEN_TOUCH_SEC = 3600

const COLS = `id, owner_id, label, token_hash, token_prefix, status, created_at, last_used_at, revoked_at`

export function toSummary(row: GwTokenRow): GwTokenSummary {
  return {
    id: row.id,
    owner_id: row.owner_id,
    label: row.label,
    prefix: row.token_prefix,
    status: GW_TOKEN_STATUSES.includes(row.status) ? row.status : 'revoked',
    created_at: row.created_at,
    last_used_at: row.last_used_at,
    revoked_at: row.revoked_at,
  }
}

export function listTokens(db: D1Database): Promise<GwTokenRow[]> {
  return db
    .prepare(`SELECT ${COLS} FROM gw_tokens ORDER BY status = 'active' DESC, id DESC`)
    .all<GwTokenRow>()
    .then((r) => r.results)
}

export function getTokenById(db: D1Database, id: number): Promise<GwTokenRow | null> {
  return db.prepare(`SELECT ${COLS} FROM gw_tokens WHERE id = ?`).bind(id).first<GwTokenRow>()
}

/** Tra token ĐANG HOẠT ĐỘNG theo băm. Đọc 1 dòng qua chỉ mục duy nhất `token_hash`. */
export function findActiveTokenByHash(db: D1Database, hash: string): Promise<GwTokenRow | null> {
  return db
    .prepare(`SELECT ${COLS} FROM gw_tokens WHERE token_hash = ? AND status = 'active'`)
    .bind(hash)
    .first<GwTokenRow>()
}

/**
 * Cấp token cho một người. Mỗi người chỉ có một token đang hoạt động (chỉ mục duy nhất từng phần):
 * đã có thì 409. Token thô chỉ có trong giá trị trả về.
 */
export async function createToken(
  db: D1Database,
  input: { ownerId: number; label: string },
  now: number,
): Promise<{ token: string; row: GwTokenRow }> {
  const gen = await generateGwToken()
  try {
    const row = await db
      .prepare(
        `INSERT INTO gw_tokens (owner_id, label, token_hash, token_prefix, status, created_at)
         VALUES (?, ?, ?, ?, 'active', ?) RETURNING ${COLS}`,
      )
      .bind(input.ownerId, input.label, gen.tokenHash, gen.tokenPrefix, now)
      .first<GwTokenRow>()
    if (!row) throw new AppError(500, 'INTERNAL', 'Không tạo được token')
    return { token: gen.token, row }
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(409, 'CONFLICT', 'Người dùng này đã có token đang hoạt động')
    }
    throw error
  }
}

/**
 * Đặt lại: sinh token mới thay chỗ băm cũ trên CÙNG dòng, token cũ chết ngay. null nếu không có dòng;
 * 409 nếu token đã bị thu hồi (muốn dùng lại phải cấp mới).
 */
export async function resetToken(
  db: D1Database,
  id: number,
): Promise<{ token: string; row: GwTokenRow } | null> {
  const current = await getTokenById(db, id)
  if (!current) return null
  if (current.status !== 'active') {
    throw new AppError(409, 'CONFLICT', 'Token đã bị thu hồi, hãy cấp token mới')
  }
  const gen = await generateGwToken()
  const row = await db
    .prepare(
      `UPDATE gw_tokens SET token_hash = ?, token_prefix = ?, last_used_at = NULL
       WHERE id = ? AND status = 'active' RETURNING ${COLS}`,
    )
    .bind(gen.tokenHash, gen.tokenPrefix, id)
    .first<GwTokenRow>()
  if (!row) throw new AppError(409, 'CONFLICT', 'Token đã bị thu hồi, hãy cấp token mới')
  return { token: gen.token, row }
}

/** Thu hồi vĩnh viễn. Gọi lại trên token đã thu hồi là no-op và trả về dòng hiện có. */
export async function revokeToken(
  db: D1Database,
  id: number,
  now: number,
): Promise<GwTokenRow | null> {
  await db
    .prepare(
      `UPDATE gw_tokens SET status = 'revoked', revoked_at = ? WHERE id = ? AND status = 'active'`,
    )
    .bind(now, id)
    .run()
  return getTokenById(db, id)
}

/** Ghi `last_used_at` nhưng tối đa mỗi giờ một lần. Không đẩy đồng bộ (trigger bỏ qua cột này). */
export async function touchTokenUsed(db: D1Database, row: GwTokenRow, now: number): Promise<void> {
  if (row.last_used_at !== null && now - row.last_used_at < TOKEN_TOUCH_SEC) return
  await db.prepare('UPDATE gw_tokens SET last_used_at = ? WHERE id = ?').bind(now, row.id).run()
}

/**
 * Chỉ cho môi trường dev: bảo đảm `token` (cố định) là token đang hoạt động của `ownerId`.
 * Chạy lại không đổi gì; token dev khác của cùng người thì bị thay (không để dòng thừa).
 */
export async function ensureDevToken(
  db: D1Database,
  token: string,
  ownerId: number,
  label: string,
  now: number,
): Promise<void> {
  const hash = await sha256Hex(token)
  const prefix = token.slice(0, 12)
  if (await findActiveTokenByHash(db, hash)) return
  const mine = await db
    .prepare(`SELECT id FROM gw_tokens WHERE owner_id = ? AND status = 'active'`)
    .bind(ownerId)
    .first<{ id: number }>()
  if (mine) {
    await db
      .prepare(
        'UPDATE gw_tokens SET token_hash = ?, token_prefix = ?, label = ?, last_used_at = NULL WHERE id = ?',
      )
      .bind(hash, prefix, label, mine.id)
      .run()
    return
  }
  await db.prepare('DELETE FROM gw_tokens WHERE token_hash = ?').bind(hash).run()
  await db
    .prepare(
      `INSERT INTO gw_tokens (owner_id, label, token_hash, token_prefix, status, created_at)
       VALUES (?, ?, ?, ?, 'active', ?)`,
    )
    .bind(ownerId, label, hash, prefix, now)
    .run()
}
