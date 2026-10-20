import type { HealthResponse } from '@az-sentinel/shared'
import { Hono } from 'hono'
import type { AppEnv } from '../types'

export const health = new Hono<AppEnv>()

/** Không xác thực, không lộ phiên bản hay cấu hình (Rules BE mục 9). */
health.get('/health', (c) => c.json<HealthResponse>({ status: 'ok' }))
