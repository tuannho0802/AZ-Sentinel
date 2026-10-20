import { Hono } from 'hono'
import { notFound, onError } from './middleware/error-handler'
import { requestLogger } from './middleware/request-logger'
import { health } from './routes/health'
import { ingestRoutes } from './routes/ingest'
import type { AppEnv } from './types'

export function createApp() {
  const app = new Hono<AppEnv>()
  app.use('*', requestLogger)
  app.route('/api', health)
  app.route('/api/ea/v1', ingestRoutes)
  app.onError(onError)
  app.notFound(notFound)
  return app
}
