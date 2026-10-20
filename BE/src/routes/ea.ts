import { ingestPayloadSchema, MAX_INGEST_BODY_BYTES } from '@az-sentinel/shared'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { AppError, errorBody } from '../lib/app-error'
import { sha256Hex } from '../lib/crypto'
import { nowUnix } from '../lib/time'
import type { HubClient } from '../live/hub-types'
import { HUB_NAME } from '../live/routes/live-ws'
import { ingest } from '../services/ingest-service'
import { gate, ingestLive, liveConfig } from '../services/live-service'
import type { AppEnv, Bindings } from '../types'

const MAX_KEY_LENGTH = 128

export type HubProvider = (env: Bindings) => HubClient
export const defaultHub: HubProvider = (env) => env.LIVE_HUB.getByName(HUB_NAME)

function readKey(raw: string | undefined): string {
  if (!raw || raw.length > MAX_KEY_LENGTH) {
    throw new AppError(401, 'INVALID_API_KEY', 'API key không hợp lệ')
  }
  return raw
}

/** Các endpoint của EA: `GET /gate` (Plan 3B) và `POST /ingest`. */
export function createEaRoutes(getHub: HubProvider = defaultHub) {
  const routes = new Hono<AppEnv>()

  routes.get('/gate', async (c) => {
    const keyHash = await sha256Hex(readKey(c.req.header('X-API-Key')))
    const body = await gate({
      db: c.env.DB,
      hub: getHub(c.env),
      keyHash,
      now: nowUnix(),
      cfg: liveConfig(c.env),
      debugMeta: c.env.INGEST_DEBUG_META === '1',
    })
    c.header('Cache-Control', 'no-store')
    return c.json(body)
  })

  routes.post(
    '/ingest',
    // Bước 1: từ chối body quá 64 KB.
    bodyLimit({
      maxSize: MAX_INGEST_BODY_BYTES,
      onError: (c) => c.json(errorBody('PAYLOAD_TOO_LARGE', 'Nội dung gửi lên quá lớn'), 413),
    }),
    // Bước 2: zod. Message chỉ nêu đường dẫn trường lỗi.
    zValidator('json', ingestPayloadSchema, (result, c) => {
      if (!result.success) {
        const path = result.error.issues[0]?.path.join('.') || 'body'
        return c.json(errorBody('VALIDATION_FAILED', `Dữ liệu không hợp lệ: ${path}`), 400)
      }
    }),
    async (c) => {
      const keyHash = await sha256Hex(readKey(c.req.header('X-API-Key')))
      const payload = c.req.valid('json')
      const common = {
        db: c.env.DB,
        keyHash,
        payload,
        ip: c.req.header('CF-Connecting-IP') ?? null,
        now: nowUnix(),
        debugMeta: c.env.INGEST_DEBUG_META === '1',
      }
      const isLive = payload.reason.includes('live') || payload.reason.includes('backfill')
      const result = isLive
        ? await ingestLive({
            ...common,
            hub: getHub(c.env),
            nowMs: Date.now(),
            cfg: liveConfig(c.env),
          })
        : await ingest(common)
      c.header('Cache-Control', 'no-store')
      return c.json(result)
    },
  )

  return routes
}
