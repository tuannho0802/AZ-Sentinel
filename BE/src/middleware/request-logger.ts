import type { MiddlewareHandler } from 'hono'
import { logJson } from '../lib/logger'
import type { AppEnv } from '../types'

/** Gán requestId và ghi một dòng log JSON mỗi request (không có body/header). */
export const requestLogger: MiddlewareHandler<AppEnv> = async (c, next) => {
  const requestId = crypto.randomUUID()
  c.set('requestId', requestId)
  c.header('X-Request-Id', requestId)
  const startedAt = Date.now()
  await next()
  logJson('info', {
    requestId,
    method: c.req.method,
    route: c.req.routePath,
    status: c.res.status,
    durationMs: Date.now() - startedAt,
  })
}
