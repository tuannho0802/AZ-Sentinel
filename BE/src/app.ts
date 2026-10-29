import { SERVED_BY_HEADER, SERVER_MODE_HEADER } from '@az-sentinel/shared'
import { Hono, type MiddlewareHandler } from 'hono'
import { createEdgeRouter, type EdgeRouterOptions } from './edge/edge-router'
import { createPageHandler } from './edge/page-router'
import { createGwWsRoutes } from './live/routes/gw-ws'
import { createLiveWsRoutes } from './live/routes/live-ws'
import { resolveViewer, type ViewerAuth } from './live/viewer-auth'
import { csrfGuard } from './middleware/csrf-guard'
import { notFound, onError } from './middleware/error-handler'
import { requestLogger } from './middleware/request-logger'
import { securityHeaders } from './middleware/security-headers'
import { createAdminDeviceRoutes } from './routes/admin-device'
import { createAdminIpRoutes } from './routes/admin-ip'
import { createAdminTokenRoutes } from './routes/admin-tokens'
import { createAdminUserRoutes } from './routes/admin-users'
import { createAuthRoutes } from './routes/auth'
import { devLinks } from './routes/dev-links'
import { createEaRoutes, defaultHub, type HubProvider } from './routes/ea'
import { health } from './routes/health'
import { createLinkRoutes } from './routes/links'
import { createAlertSettingsRoutes, createNotificationRoutes } from './routes/notifications'
import { createServerInfoRoutes } from './routes/server-info'
import { createSyncRoutes } from './routes/sync'
import type { AppEnv } from './types'

export type AppOptions = {
  getHub?: HubProvider
  viewerAuth?: ViewerAuth
  /** Chỉ để kiểm thử bộ định tuyến biên. */
  edge?: EdgeRouterOptions
}

/** Ghi vai trò node và chế độ vào header phản hồi (Plan 3E). Bỏ qua 101 (WebSocket). */
const markServed: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next()
  if (c.res.status === 101) return
  if (!c.res.headers.has(SERVED_BY_HEADER)) {
    c.header(SERVED_BY_HEADER, c.get('servedBy') ?? c.env.HOST?.role ?? 'cloudflare')
  }
  const mode = c.get('mode')
  if (mode) c.header(SERVER_MODE_HEADER, mode)
}

export function createApp(opts: AppOptions = {}) {
  const app = new Hono<AppEnv>()
  app.use('*', requestLogger)
  app.use('*', securityHeaders)
  app.use('/api/*', markServed)
  app.use('/api/*', csrfGuard)
  app.use('/api/*', createEdgeRouter(opts.edge))
  app.route('/api', health)
  app.route('/api/server-info', createServerInfoRoutes(opts.viewerAuth ?? resolveViewer, opts.edge))
  app.route('/api/sync', createSyncRoutes(opts.edge?.origins))
  app.route('/api/ea/v1', createEaRoutes(opts.getHub ?? defaultHub))
  app.route('/api/live', createLiveWsRoutes(opts.viewerAuth ?? resolveViewer))
  app.route('/api/gw', createGwWsRoutes(opts.edge?.origins))
  // Plan 4: quản trị viên cấp, đặt lại, thu hồi token Gateway cá nhân.
  app.route('/api/admin/gw-tokens', createAdminTokenRoutes(opts.viewerAuth ?? resolveViewer))
  // Plan 4B: người dùng, đăng nhập thật và quản lý người dùng.
  app.route('/api', createAuthRoutes(opts.viewerAuth ?? resolveViewer))
  app.route('/api/admin/users', createAdminUserRoutes(opts.viewerAuth ?? resolveViewer))
  app.route('/api/admin/ip-rules', createAdminIpRoutes(opts.viewerAuth ?? resolveViewer))
  app.route('/api/admin/device-rules', createAdminDeviceRoutes(opts.viewerAuth ?? resolveViewer))
  app.route('/api/links', createLinkRoutes(opts.viewerAuth ?? resolveViewer))
  // Plan 5: thông báo cảnh báo lỗ float và cài đặt ngưỡng của chính người dùng.
  app.route('/api/notifications', createNotificationRoutes(opts.viewerAuth ?? resolveViewer))
  app.route('/api/settings/alerts', createAlertSettingsRoutes(opts.viewerAuth ?? resolveViewer))
  // DEV Part 1: quản lý liên kết không cần đăng nhập, chỉ bật bằng DEV_LINKS_API. Xóa khi có Part 2/3.
  app.route('/api/dev', devLinks)
  // Plan 3J: mọi đường ngoài /api (lượt tải trang): chuyển hướng sang Quick Tunnel đang sống hoặc phục vụ giao diện dự phòng.
  app.all('*', createPageHandler(opts.edge))
  app.onError(onError)
  app.notFound(notFound)
  return app
}
