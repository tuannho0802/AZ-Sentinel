import type { UserRole } from '@az-sentinel/shared'
import { generateSessionToken, sha256Hex } from '../lib/crypto'

/** Tên cookie phiên (HttpOnly). Giá trị là mã thô; DB chỉ lưu băm. */
export const SESSION_COOKIE = 'az_session'
/** Hạn phiên: 7 ngày kể từ lúc đăng nhập (không tự gia hạn). */
export const SESSION_TTL_SEC = 7 * 24 * 3600

export type SessionInfo = { userId: number; role: UserRole; expiresAt: number }

/** Tạo phiên mới và dọn các phiên đã hết hạn của chính người đó. */
export async function createSession(
    db: D1Database,
    userId: number,
    now: number,
): Promise<{ token: string; expiresAt: number }> {
    const { token, tokenHash } = await generateSessionToken()
    const expiresAt = now + SESSION_TTL_SEC
    await db.batch([
        db.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at <= ?').bind(userId, now),
        db
            .prepare(
                'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
            )
            .bind(tokenHash, userId, now, expiresAt),
    ])
    return { token, expiresAt }
}

/** Tra phiên còn hạn của người dùng ĐANG HOẠT ĐỘNG. null nếu không hợp lệ. */
export async function findSession(
    db: D1Database,
    token: string,
    now: number,
): Promise<SessionInfo | null> {
    if (token.length < 20 || token.length > 128) return null
    const row = await db
        .prepare(
            `SELECT s.user_id AS userId, s.expires_at AS expiresAt, u.role AS role
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'active'`,
        )
        .bind(await sha256Hex(token), now)
        .first<SessionInfo>()
    return row ?? null
}

export async function deleteSession(db: D1Database, token: string): Promise<void> {
    await db
        .prepare('DELETE FROM sessions WHERE token_hash = ?')
        .bind(await sha256Hex(token))
        .run()
}

/** Đăng xuất mọi thiết bị của một người (khóa tài khoản, đổi mật khẩu). */
export async function deleteUserSessions(db: D1Database, userId: number): Promise<void> {
    await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run()
}

export function sessionCookie(token: string, maxAgeSec: number, secure: boolean): string {
    return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`
}

export function clearSessionCookie(secure: boolean): string {
    return sessionCookie('', 0, secure)
}