import type { ServerNode } from '@az-sentinel/shared'
import type { Bindings } from '../types'
import { APP_VERSION } from './version'

const BOOT_SEC = Math.floor(Date.now() / 1000)

/**
 * Thông tin node Cloudflare. Worker không biết máy chủ vật lý nên chỉ có vai trò, tên cấu hình và
 * trung tâm dữ liệu (colo) xử lý request. `startedAt` là lúc isolate nạp module, không phải giờ deploy.
 */
export function cloudflareNode(env: Bindings, colo: string | undefined): ServerNode {
  const now = Math.floor(Date.now() / 1000)
  return {
    role: 'cloudflare',
    name: (env.SERVER_NAME ?? '').trim().slice(0, 64) || 'Cloudflare',
    host: null,
    os: null,
    arch: null,
    runtime: 'cloudflare-workers',
    version: APP_VERSION,
    startedAt: BOOT_SEC,
    uptimeSec: Math.max(0, now - BOOT_SEC),
    cpuCount: null,
    memTotalMb: null,
    memFreeMb: null,
    cpuPct: null,
    location: colo ? colo.slice(0, 64) : null,
  }
}
