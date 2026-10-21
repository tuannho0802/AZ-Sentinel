import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { GW } from '@az-sentinel/shared'
import { z } from 'zod'

const configSchema = z.object({
  /** Cổng loopback cho EA. */
  port: z.number().int().min(1024).max(65535).default(GW.defaultPort),
  /** URL WebSocket của hub, vd `wss://<tên>.workers.dev/api/gw/ws`. Rỗng = chỉ chạy cục bộ. */
  cloudUrl: z.string().default(''),
  /** Bí mật chung với Worker (`GW_CONNECT_TOKEN`), gửi trong header Authorization khi nối cloud. */
  cloudToken: z.string().default(''),
  /** Giữ `event` khi không ai xem trong chừng này giây (0 = gửi ngay). */
  idleFlushSec: z.number().int().min(0).max(86400).default(GW.idleFlushSec),
  /** Nhãn VPS gửi trong `hello`. */
  vps: z.string().max(64).default(os.hostname().slice(0, 64)),
  /** Thư mục lưu hàng đợi sự kiện. */
  dataDir: z.string().default(defaultDataDir()),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
})
export type GatewayConfig = z.infer<typeof configSchema>

export function defaultDataDir(): string {
  if (process.platform === 'win32') {
    return path.join(process.env.ProgramData ?? 'C:\\ProgramData', 'AZSentinel')
  }
  return path.join(os.homedir(), '.az-sentinel')
}

/**
 * Nạp cấu hình: file JSON (đường dẫn trong `AZ_GW_CONFIG`, mặc định `<dataDir>/config.json`),
 * rồi biến môi trường ghi đè: AZ_GW_PORT, AZ_GW_CLOUD_URL, AZ_GW_TOKEN, AZ_GW_IDLE_FLUSH_SEC, AZ_GW_VPS, AZ_GW_DATA, AZ_GW_LOG.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const dataDir = env.AZ_GW_DATA ?? defaultDataDir()
  const file = env.AZ_GW_CONFIG ?? path.join(dataDir, 'config.json')
  let fromFile: unknown = {}
  if (existsSync(file)) {
    try {
      fromFile = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      throw new Error(`Không đọc được file cấu hình ${file}: JSON không hợp lệ`)
    }
  }
  const overrides: Record<string, unknown> = {}
  if (env.AZ_GW_PORT) overrides.port = Number(env.AZ_GW_PORT)
  if (env.AZ_GW_CLOUD_URL) overrides.cloudUrl = env.AZ_GW_CLOUD_URL
  if (env.AZ_GW_TOKEN) overrides.cloudToken = env.AZ_GW_TOKEN
  if (env.AZ_GW_IDLE_FLUSH_SEC) overrides.idleFlushSec = Number(env.AZ_GW_IDLE_FLUSH_SEC)
  if (env.AZ_GW_VPS) overrides.vps = env.AZ_GW_VPS
  if (env.AZ_GW_DATA) overrides.dataDir = env.AZ_GW_DATA
  if (env.AZ_GW_LOG) overrides.logLevel = env.AZ_GW_LOG
  const base = typeof fromFile === 'object' && fromFile !== null ? fromFile : {}
  const parsed = configSchema.safeParse({ ...base, ...overrides })
  if (!parsed.success) {
    const i = parsed.error.issues[0]
    throw new Error(`Cấu hình không hợp lệ: ${i?.path.join('.')} ${i?.message}`)
  }
  return parsed.data
}
