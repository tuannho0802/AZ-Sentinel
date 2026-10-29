import { applySecurityHeaders } from '@az-sentinel/shared'
import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../types'

/** Request đi qua HTTPS (trực tiếp hoặc qua Cloudflare/tunnel) thì mới gắn HSTS. */
function isHttps(url: string, forwardedProto: string | undefined): boolean {
  return new URL(url).protocol === 'https:' || forwardedProto?.split(',')[0]?.trim() === 'https'
}

/**
 * Gắn header bảo mật (CSP, chống nhúng iframe, nosniff...) vào mọi phản hồi trừ nâng cấp WebSocket (101).
 * Phản hồi lấy từ `ASSETS.fetch` có header bất biến nên dựng lại `Response` thay vì sửa tại chỗ.
 */
export const securityHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next()
  const res = c.res
  if (res.status === 101) return
  const kind = new URL(c.req.url).pathname.startsWith('/api/') ? 'api' : 'ui'
  const headers = new Headers(res.headers)
  applySecurityHeaders(headers, kind, isHttps(c.req.url, c.req.header('X-Forwarded-Proto')))
  c.res = new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}
