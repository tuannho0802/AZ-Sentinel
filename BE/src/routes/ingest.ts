import { ingestPayloadSchema, MAX_INGEST_BODY_BYTES } from '@az-sentinel/shared'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { AppError, errorBody } from '../lib/app-error'
import { sha256Hex } from '../lib/crypto'
import { nowUnix } from '../lib/time'
import { ingest } from '../services/ingest-service'
import type { AppEnv } from '../types'

export const ingestRoutes = new Hono<AppEnv>()

const MAX_KEY_LENGTH = 128

ingestRoutes.post(
  '/ingest',
  // Bước 1: từ chối body quá 64 KB (kiểm tra Content-Length, hoặc chặn khi đang đọc luồng).
  bodyLimit({
    maxSize: MAX_INGEST_BODY_BYTES,
    onError: (c) => c.json(errorBody('PAYLOAD_TOO_LARGE', 'Nội dung gửi lên quá lớn'), 413),
  }),
  // Bước 2: zod. Message chỉ nêu đường dẫn trường lỗi, không lộ chi tiết nội bộ.
  zValidator('json', ingestPayloadSchema, (result, c) => {
    if (!result.success) {
      const path = result.error.issues[0]?.path.join('.') || 'body'
      return c.json(errorBody('VALIDATION_FAILED', `Dữ liệu không hợp lệ: ${path}`), 400)
    }
  }),
  async (c) => {
    const key = c.req.header('X-API-Key')
    if (!key || key.length > MAX_KEY_LENGTH) {
      throw new AppError(401, 'INVALID_API_KEY', 'API key không hợp lệ')
    }
    const result = await ingest({
      db: c.env.DB,
      keyHash: await sha256Hex(key),
      payload: c.req.valid('json'),
      ip: c.req.header('CF-Connecting-IP') ?? null,
      now: nowUnix(),
      debugMeta: c.env.INGEST_DEBUG_META === '1',
    })
    return c.json(result)
  },
)
