import {
  USER_ROLES,
  USER_STATUSES,
  type UserRole,
  type UserStatus,
  type UserSummary,
} from '@az-sentinel/shared'
import { AppError } from '../lib/app-error'
import { hashPassword } from '../lib/password'
import { isUniqueViolation } from './ingest-service'

/** Dòng `users`. `password_hash` không bao giờ ra khỏi tầng service. */
export type UserRow = {
  id: number
  email: string
  display_name: string
  password_hash: string
  role: UserRole
  status: UserStatus
  created_at: number
  failed_logins: number
  locked_until: number | null
}

/** Sai quá số lần này thì khóa tạm tài khoản. */
export const MAX_FAILED_LOGINS = 5
/** Thời gian khóa tạm (giây). */
export const LOCK_SEC = 900

const COLS = `id, email, display_name, password_hash, role, status, created_at, failed_logins, locked_until`

export const normalizeEmail = (email: string): string => email.trim().toLowerCase()

export function toSummary(row: UserRow, hasToken: boolean): UserSummary {
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    role: USER_ROLES.includes(row.role) ? row.role : 'user',
    status: USER_STATUSES.includes(row.status) ? row.status : 'suspended',
    created_at: row.created_at,
    has_token: hasToken,
  }
}

export function findUserByEmail(db: D1Database, email: string): Promise<UserRow | null> {
  return db
    .prepare(`SELECT ${COLS} FROM users WHERE email = ?`)
    .bind(normalizeEmail(email))
    .first<UserRow>()
}

export function getUserById(db: D1Database, id: number): Promise<UserRow | null> {
  return db.prepare(`SELECT ${COLS} FROM users WHERE id = ?`).bind(id).first<UserRow>()
}

export async function hasActiveToken(db: D1Database, userId: number): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 AS x FROM gw_tokens WHERE owner_id = ? AND status = 'active' LIMIT 1`)
    .bind(userId)
    .first<{ x: number }>()
  return row !== null
}

export async function listUsers(db: D1Database): Promise<UserSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT ${COLS},
              EXISTS (SELECT 1 FROM gw_tokens t WHERE t.owner_id = users.id AND t.status = 'active') AS has_token
       FROM users ORDER BY id`,
    )
    .all<UserRow & { has_token: number }>()
  return results.map((r) => toSummary(r, r.has_token === 1))
}

export type NewUser = {
  email: string
  displayName: string
  password: string
  role: UserRole
  status?: UserStatus
}

/** Tạo người dùng. Email trùng thì 409. */
export async function createUser(db: D1Database, input: NewUser, now: number): Promise<UserRow> {
  const passwordHash = await hashPassword(input.password)
  try {
    const row = await db
      .prepare(
        `INSERT INTO users (email, display_name, password_hash, role, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING ${COLS}`,
      )
      .bind(
        normalizeEmail(input.email),
        input.displayName,
        passwordHash,
        input.role,
        input.status ?? 'active',
        now,
      )
      .first<UserRow>()
    if (!row) throw new AppError(500, 'INTERNAL', 'Không tạo được người dùng')
    return row
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError(409, 'CONFLICT', 'Email này đã được dùng')
    throw error
  }
}

export type UserPatch = {
  displayName?: string
  role?: UserRole
  status?: UserStatus
}

/** Sửa tên, vai trò, trạng thái. Trả dòng mới, null nếu không có người dùng. */
export async function updateUser(
  db: D1Database,
  id: number,
  patch: UserPatch,
): Promise<UserRow | null> {
  const sets: string[] = []
  const values: unknown[] = []
  if (patch.displayName !== undefined) {
    sets.push('display_name = ?')
    values.push(patch.displayName)
  }
  if (patch.role !== undefined) {
    sets.push('role = ?')
    values.push(patch.role)
  }
  if (patch.status !== undefined) {
    sets.push('status = ?')
    values.push(patch.status)
    // Mở lại tài khoản thì gỡ luôn khóa tạm do nhập sai.
    if (patch.status === 'active') sets.push('failed_logins = 0', 'locked_until = NULL')
  }
  if (sets.length === 0) return getUserById(db, id)
  return db
    .prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ? RETURNING ${COLS}`)
    .bind(...values, id)
    .first<UserRow>()
}

/** Đặt mật khẩu mới và gỡ khóa tạm. */
export async function setPassword(db: D1Database, id: number, password: string): Promise<void> {
  const passwordHash = await hashPassword(password)
  await db
    .prepare(
      'UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = NULL WHERE id = ?',
    )
    .bind(passwordHash, id)
    .run()
}

/** Ghi một lần đăng nhập sai; đủ số lần thì khóa tạm và đặt lại bộ đếm. */
export async function registerFailedLogin(
  db: D1Database,
  user: UserRow,
  now: number,
): Promise<void> {
  const failures = user.failed_logins + 1
  if (failures >= MAX_FAILED_LOGINS) {
    await db
      .prepare('UPDATE users SET failed_logins = 0, locked_until = ? WHERE id = ?')
      .bind(now + LOCK_SEC, user.id)
      .run()
    return
  }
  await db.prepare('UPDATE users SET failed_logins = ? WHERE id = ?').bind(failures, user.id).run()
}

/** Đăng nhập đúng: xóa bộ đếm sai (chỉ ghi khi đang có gì để xóa, tiết kiệm dòng ghi). */
export async function clearFailedLogins(db: D1Database, user: UserRow): Promise<void> {
  if (user.failed_logins === 0 && user.locked_until === null) return
  await db
    .prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?')
    .bind(user.id)
    .run()
}
/**
 * Chỉ dùng khi chạy dev (`AZ_DEV_LINKS_API=1`): tạo người dùng khớp tài khoản giả lập của FE, id cố định
 * để token dev (owner 1) và dropdown chọn người dùng chạy ngay. Mật khẩu dev: admin1234 / user1234.
 * Đã có người dùng thì không đụng gì.
 */
export async function ensureDevUsers(db: D1Database): Promise<void> {
  const any = await db.prepare('SELECT 1 AS x FROM users LIMIT 1').first<{ x: number }>()
  if (any) return
  const now = Math.floor(Date.now() / 1000)
  const seeds = [
    {
      id: 1,
      email: 'admin@az.local',
      name: 'Root Admin (dev)',
      role: 'root_admin',
      pw: 'admin1234',
    },
    { id: 2, email: 'user@az.local', name: 'Người dùng (dev)', role: 'user', pw: 'user1234' },
  ] as const
  for (const u of seeds) {
    await db
      .prepare(
        `INSERT INTO users (id, email, display_name, password_hash, role, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?)`,
      )
      .bind(u.id, u.email, u.name, await hashPassword(u.pw), u.role, now)
      .run()
  }
}

/**
 * Bộ đếm sai/khóa cho email KHÔNG tồn tại, cùng ngưỡng (`MAX_FAILED_LOGINS`) và thời gian khóa (`LOCK_SEC`) với
 * tài khoản thật để kẻ lạ không phân biệt được email nào có thật qua việc bị khóa.
 */
const THROTTLE_STALE_SEC = 7 * 86_400

/** Số giây còn bị khóa, hoặc 0 nếu không bị khóa. */
export async function unknownLoginLockWait(
  db: D1Database,
  email: string,
  now: number,
): Promise<number> {
  const row = await db
    .prepare('SELECT locked_until FROM login_throttle WHERE email = ?')
    .bind(normalizeEmail(email))
    .first<{ locked_until: number | null }>()
  return row?.locked_until != null && row.locked_until > now ? row.locked_until - now : 0
}

/** Ghi một lần sai cho email không tồn tại; đủ ngưỡng thì khóa và đặt lại bộ đếm (giống `registerFailedLogin`). */
export async function registerUnknownFailedLogin(
  db: D1Database,
  email: string,
  now: number,
): Promise<void> {
  const key = normalizeEmail(email)
  await db.batch([
    db
      .prepare(
        'DELETE FROM login_throttle WHERE updated_at < ? AND (locked_until IS NULL OR locked_until < ?)',
      )
      .bind(now - THROTTLE_STALE_SEC, now),
    // Một câu upsert nguyên tử để các lần thử song song không đếm thiếu.
    db
      .prepare(
        `INSERT INTO login_throttle (email, failed, locked_until, updated_at) VALUES (?1, 1, NULL, ?2)
         ON CONFLICT(email) DO UPDATE SET
           failed = CASE WHEN failed + 1 >= ?3 THEN 0 ELSE failed + 1 END,
           locked_until = CASE WHEN failed + 1 >= ?3 THEN ?4 ELSE locked_until END,
           updated_at = ?2`,
      )
      .bind(key, now, MAX_FAILED_LOGINS, now + LOCK_SEC),
  ])
}
