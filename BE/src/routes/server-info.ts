import { Hono } from 'hono'
import { AppError } from '../lib/app-error'
import { requireServiceToken } from '../lib/service-auth'
import type { ViewerAuth } from '../live/viewer-auth'
import { buildServerInfo, describeSelf, type ServerInfoDeps } from '../services/server-info-service'
import type { AppEnv } from '../types'

/**
 * `GET /api/server-info`: máy chủ nào đang phục vụ, VPS chính còn sống không, đồng bộ ra sao. Chỉ
 * người xem đã đăng nhập mới đọc được (tên máy, hệ điều hành, tải CPU/RAM không nên công khai).
 * `GET /api/server-info/self`: Worker hỏi VPS bằng token dịch vụ `SYNC_TOKEN`, chỉ trả thông tin của chính node.
 */
export function createServerInfoRoutes(auth: ViewerAuth, deps: ServerInfoDeps = {}) {
    const routes = new Hono<AppEnv>()

    routes.get('/', async (c) => {
        const viewer = await auth(c)
        if (!viewer) throw new AppError(401, 'UNAUTHENTICATED', 'Chưa đăng nhập')
        const info = await buildServerInfo(c, deps)
        c.set('servedBy', info.active.role)
        c.set('mode', info.mode)
        c.header('Cache-Control', 'no-store')
        return c.json(info)
    })

    routes.get('/self', async (c) => {
        await requireServiceToken(c, c.env.SYNC_TOKEN, {
            missing: 'Chưa cấu hình SYNC_TOKEN',
            invalid: 'Token dịch vụ không hợp lệ',
        })
        c.header('Cache-Control', 'no-store')
        return c.json(await describeSelf(c))
    })

    return routes
}