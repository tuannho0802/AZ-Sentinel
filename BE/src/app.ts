import { Hono } from 'hono'
import { notFound, onError } from './middleware/error-handler'
import { requestLogger } from './middleware/request-logger'
import { devLinks } from './routes/dev-links'
import { health } from './routes/health'
import { ingestRoutes } from './routes/ingest'
import { spike } from './routes/spike'
import type { AppEnv } from './types'

export function createApp() {
  const app = new Hono<AppEnv>()
  app.use('*', requestLogger)
  app.route('/api', health)
  app.route('/api/ea/v1', ingestRoutes)
  // DEV Part 1: quản lý liên kết không cần đăng nhập, chỉ bật bằng DEV_LINKS_API. Xóa khi có Part 2/3.
  app.route('/api/dev', devLinks)
  // SPIKE (P1-19): xóa ở P1-31.
  app.route('/api/_spike', spike)
  app.onError(onError)
  app.notFound(notFound)
  return app
}
