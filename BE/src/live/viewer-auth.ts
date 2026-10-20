import type { UserRole } from '@az-sentinel/shared'
import type { Context } from 'hono'
import type { AppEnv } from '../types'

/** Người xem đã xác thực. `expiresAt` (ms) để hub tự đá khi phiên hết hạn; null = không hết hạn. */
export type Viewer = { userId: number; role: UserRole; expiresAt: number | null }

/**
 * Adapter xác thực người xem WebSocket (Plan 3B mục 7). Chỉ trả người dùng ĐÃ được xác thực và
 * ĐANG hoạt động; mọi trường hợp khác trả null (route sẽ trả 401). Part 2 thay `resolveViewer`
 * bằng tra phiên thật (cookie phiên -> bản băm trong DB, kiểm tra hạn và trạng thái User).
 */
export type ViewerAuth = (c: Context<AppEnv>) => Promise<Viewer | null> | Viewer | null

/** Trùng với `FE/dev-mock-auth.ts`. Chỉ dùng khi chạy dev; không phải đăng nhập thật. */
const MOCK_COOKIE = 'az_mock_session'
const DEV_VIEWERS: Record<string, Viewer> = {
    'admin@az.local': { userId: 1, role: 'root_admin', expiresAt: null },
    'user@az.local': { userId: 2, role: 'user', expiresAt: null },
}

function readCookie(header: string | undefined, name: string): string | null {
    if (!header) return null
    for (const part of header.split(';')) {
        const eq = part.indexOf('=')
        if (eq < 0) continue
        if (part.slice(0, eq).trim() !== name) continue
        try {
            return decodeURIComponent(part.slice(eq + 1).trim())
        } catch {
            return null
        }
    }
    return null
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

/** Part 2: thay bằng tra phiên thật. */
export const resolveViewer: ViewerAuth = devViewerAuth