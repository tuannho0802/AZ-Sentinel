import { FAILOVER, syncApplySchema, syncHeartbeatSchema } from '@az-sentinel/shared'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { AppError, errorBody } from '../lib/app-error'
import { requireServiceToken } from '../lib/service-auth'
import { nowUnix } from '../lib/time'
import { saveHeartbeat } from '../services/server-info-service'
import { applySync, readTradesSince } from '../services/sync-service'
import type { AppEnv } from '../types'

const MAX_SYNC_BODY_BYTES = 256 * 1024

const tradesQuerySchema = z.object({
    since: z.coerce.number().int().nonnegative(),
    after_link: z.coerce.number().int().nonnegative().default(0),
    after_ticket: z.coerce.number().int().default(0),
    limit: z.coerce.number().int().min(1).max(FAILOVER.syncBatch * 4).default(FAILOVER.syncBatch * 2),
})

const invalid = (result: { success: boolean; error?: z.ZodError }, c: { json: Function }) => {
    if (!result.success) {
        const path = result.error?.issues[0]?.path.join('.') || 'body'
        return c.json(errorBody('VALIDATION_FAILED', `Dữ liệu không hợp lệ: ${path}`), 400)
    }
}

/**
 * Đường đồng bộ VPS <-> Cloudflare (Plan 3E). Mọi route cần `Authorization: Bearer <SYNC_TOKEN>`.
 * - `POST /heartbeat`: VPS báo còn sống, kèm thông tin máy (để giao diện dự phòng hiện VPS lần cuối).
 * - `POST /apply`: VPS đẩy thay đổi `ea_links` và `trades` để Cloudflare luôn sẵn sàng thay thế.
 * - `GET /trades`: VPS kéo các lệnh Cloudflare đã ghi trong lúc dự phòng.
 */
export function createSyncRoutes() {
    const routes = new Hono<AppEnv>()

    routes.use('*', async (c, next) => {
        await requireServiceToken(c, c.env.SYNC_TOKEN, {
            missing: 'Chưa cấu hình SYNC_TOKEN',
            invalid: 'Token đồng bộ không hợp lệ',
        })
        c.header('Cache-Control', 'no-store')
        await next()
    })

    routes.post('/heartbeat', zValidator('json', syncHeartbeatSchema, invalid), async (c) => {
        const { node } = c.req.valid('json')
        if (node.role !== 'vps') throw new AppError(400, 'VALIDATION_FAILED', 'Chỉ nhận nhịp sống của VPS')
        await saveHeartbeat(c.env.DB, node, nowUnix())
        return c.json({ ok: true, now: nowUnix() })
    })

    routes.post(
        '/apply',
        bodyLimit({
            maxSize: MAX_SYNC_BODY_BYTES,
            onError: (c) => c.json(errorBody('PAYLOAD_TOO_LARGE', 'Nội dung gửi lên quá lớn'), 413),
        }),
        zValidator('json', syncApplySchema, invalid),
        async (c) => c.json({ applied: await applySync(c.env.DB, c.req.valid('json')) }),
    )

    routes.get('/trades', zValidator('query', tradesQuerySchema, invalid), async (c) => {
        const q = c.req.valid('query')
        const page = await readTradesSince(
            c.env.DB,
            q.since,
            { link_id: q.after_link, ticket: q.after_ticket },
            q.limit,
        )
        return c.json(page)
    })

    return routes
}