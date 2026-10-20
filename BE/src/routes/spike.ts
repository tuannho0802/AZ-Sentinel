import { Hono } from 'hono'
import { AppError } from '../lib/app-error'
import type { AppEnv } from '../types'

/**
 * SPIKE Part 1 (P1-19): đo thời gian PBKDF2-SHA256. PHẢI XÓA trước Part 2 (P1-31).
 * workerd giới hạn PBKDF2 ở 100.000 vòng lặp.
 */
export const spike = new Hono<AppEnv>()

const MAX_ITER = 100_000

spike.get('/hash', async (c) => {
  const iter = Number(c.req.query('iter'))
  if (!Number.isInteger(iter) || iter < 1 || iter > MAX_ITER) {
    throw new AppError(400, 'VALIDATION_FAILED', `iter phải là số nguyên từ 1 đến ${MAX_ITER}`)
  }
  const enc = new TextEncoder()
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const startedAt = Date.now()
  const key = await crypto.subtle.importKey('raw', enc.encode('spike-password'), 'PBKDF2', false, [
    'deriveBits',
  ])
  await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter },
    key,
    256,
  )
  return c.json({ iter, wallMs: Date.now() - startedAt })
})
