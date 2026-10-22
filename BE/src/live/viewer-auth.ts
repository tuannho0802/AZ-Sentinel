import type { UserRole } from '@az-sentinel/shared'
import type { Context } from 'hono'
import { readCookie } from '../lib/cookies'
import { nowUnix } from '../lib/time'
import { findSession, SESSION_COOKIE } from '../services/session-service'
import type { AppEnv } from '../types'

/** Người xem đã xác thực. `expiresAt` (ms) để hub tự đá khi phiên hết hạn; null = không hết hạn. */
export type Viewer = { userId: number; role: UserRole; expiresAt: number | null }

/**
 * Adapter xác thực người xem WebSocket (Plan 3B mục 7). Chỉ trả người dùng ĐÃ được xác thực và
 * ĐANG hoạt động; mọi trường hợp khác trả null (route sẽ trả 401). `resolveViewer` tra phiên thật
 * (cookie phiên -> bản băm trong DB, kiểm tra hạn và trạng thái User); chỉ khi chạy dev mới tin thêm
 * cookie giả lập của FE.
 */
export type ViewerAuth = (c: Context<AppEnv>) => Promise<Viewer | null> | Viewer | null

/** Trùng với `FE/dev-mock-auth.ts`. Chỉ dùng khi chạy dev; không phải đăng nhập thật. */
const MOCK_COOKIE = 'az_mock_session'
const DEV_VIEWERS: Record<string, Viewer> = {
  'admin@az.local': { userId: 1, role: 'root_admin', expiresAt: null },
  'user@az.local': { userId: 2, role: 'user', expiresAt: null },
}

/**
 * Adapter dev: tin cookie giả lập của dev server FE. Chỉ hoạt động khi DEV_LINKS_API=1 (cờ chỉ
 * truyền bằng `wrangler dev --var`); không có cờ thì luôn null nên bản deploy từ chối mọi viewer
 * cho tới khi Part 2 có xác thực thật (an toàn mặc định).
 */
export const devViewerAuth: ViewerAuth = (c) => {
  if (c.env.DEV_LINKS_API !== '1') return null
  const email = readCookie(c.req.header('Cookie'), MOCK_COOKIE)
  return email ? (DEV_VIEWERS[email.toLowerCase()] ?? null) : null
}

/** Người xem từ cookie phiên thật (`az_session`). null nếu thiếu, hết hạn hoặc người dùng không còn active. */
export const sessionViewer: ViewerAuth = async (c) => {
  const token = readCookie(c.req.header('Cookie'), SESSION_COOKIE)
  if (!token) return null
  const session = await findSession(c.env.DB, token, nowUnix())
  if (!session) return null
  return { userId: session.userId, role: session.role, expiresAt: session.expiresAt * 1000 }
}

/** Phiên thật trước; không có thì (chỉ khi dev) thử cookie giả lập. */
export const resolveViewer: ViewerAuth = async (c) => (await sessionViewer(c)) ?? devViewerAuth(c)
