import { Hono } from 'hono'
import { createLiveWsRoutes } from './live/routes/live-ws'
import { resolveViewer, type ViewerAuth } from './live/viewer-auth'
import { notFound, onError } from './middleware/error-handler'
import { requestLogger } from './middleware/request-logger'
import { devLinks } from './routes/dev-links'
import { createEaRoutes, defaultHub, type HubProvider } from './routes/ea'
import { health } from './routes/health'
import { spike } from './routes/spike'
import type { AppEnv } from './types'

export type AppOptions = { getHub?: HubProvider; viewerAuth?: ViewerAuth }

export function createApp(opts: AppOptions = {}) {
  const app = new Hono<AppEnv>()
  app.use('*', requestLogger)
  app.route('/api', health)
  app.route('/api/ea/v1', createEaRoutes(opts.getHub ?? defaultHub))
  app.route('/api/live', createLiveWsRoutes(opts.viewerAuth ?? resolveViewer))
  // DEV Part 1: quản lý liên kết không cần đăng nhập, chỉ bật bằng DEV_LINKS_API. Xóa khi có Part 2/3.
  app.route('/api/dev', devLinks)
  // SPIKE (P1-19): xóa ở P1-31.
  app.route('/api/_spike', spike)
  app.onError(onError)
  app.notFound(notFound)
  return app
}
