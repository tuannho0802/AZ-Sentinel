import type { MiddlewareHandler } from 'hono'
import { AppError } from '../lib/app-error'
import { isOriginAllowed } from '../live/origin'
import type { AppEnv } from '../types'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Lớp chống CSRF thứ hai cho mọi route GHI (SameSite=Lax là lớp đầu). Trình duyệt luôn gửi `Origin` với
 * request chéo nguồn không an toàn, nên nếu có Origin thì phải cùng host, nằm trong `LIVE_ALLOWED_ORIGINS`
 * hoặc (dev) là origin Vite. Không có Origin = client không phải trình duyệt (EA, Gateway, đồng bộ VPS):
 * bỏ qua, các đường đó có xác thực bằng khóa/token riêng.
 */
export const csrfGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) return next()
  const allowed = isOriginAllowed({
    origin: c.req.header('Origin'),
    requestHost: new URL(c.req.url).host,
    allowedCsv: c.env.LIVE_ALLOWED_ORIGINS,
    dev: c.env.DEV_LINKS_API === '1',
  })
  if (!allowed) throw new AppError(403, 'FORBIDDEN', 'Nguồn yêu cầu không được phép')
  return next()
}
