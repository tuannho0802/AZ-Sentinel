import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { GW } from '@az-sentinel/shared'
import { z } from 'zod'

const configSchema = z.object({
  /** Cổng loopback cho EA. */
  port: z.number().int().min(1024).max(65535).default(GW.defaultPort),
  /** URL WebSocket của hub, vd `wss://<tên>.workers.dev/api/gw/ws`. Rỗng = chỉ chạy cục bộ. */
  cloudUrl: z.string().default(''),
  /**
   * URL WebSocket dự phòng (Worker Cloudflare), dùng khi `cloudUrl` (VPS chính) không nối được. Gateway tự
   * quay về `cloudUrl` khi VPS sống lại. Rỗng = không có dự phòng.
   */
  cloudFallbackUrl: z.string().default(''),
  /** Token Gateway cá nhân `azt_...` do quản trị viên cấp riêng cho bạn; gửi trong header Authorization khi nối cloud. */
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
 * rồi biến môi trường ghi đè: AZ_GW_PORT, AZ_GW_CLOUD_URL, AZ_GW_CLOUD_FALLBACK_URL, AZ_GW_TOKEN, AZ_GW_IDLE_FLUSH_SEC, AZ_GW_VPS, AZ_GW_DATA, AZ_GW_LOG.
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
  if (env.AZ_GW_CLOUD_FALLBACK_URL) overrides.cloudFallbackUrl = env.AZ_GW_CLOUD_FALLBACK_URL
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

/** Các trường người dùng được sửa từ giao diện cục bộ (không gồm `port`, `dataDir`: đổi tay trong file). */
export const editableSchema = z.object({
  cloudUrl: z
    .string()
    .trim()
    .refine((v) => v === '' || /^wss?:\/\/[^\s]+$/i.test(v), 'phải bắt đầu bằng wss:// hoặc ws://'),
  /** Địa chỉ dự phòng; rỗng = không có (xem `cloudFallbackUrl` ở trên). */
  cloudFallbackUrl: z
    .string()
    .trim()
    .refine((v) => v === '' || /^wss?:\/\/[^\s]+$/i.test(v), 'phải bắt đầu bằng wss:// hoặc ws://')
    .optional(),
  /** Chuỗi rỗng = giữ token cũ (giao diện không bao giờ nhận lại token). */
  cloudToken: z.string().trim().max(512),
  vps: z.string().trim().min(1).max(64),
  idleFlushSec: z.number().int().min(0).max(86400),
})
export type EditableConfig = z.infer<typeof editableSchema>

/**
 * Tên file cờ "đã tắt hoàn toàn". Có file này thì `run-gateway.cmd` không bật Gateway lại (kể cả
 * sau khi khởi động lại máy) cho đến khi người dùng bật bằng shortcut. `run-gateway.cmd`,
 * `start-gateway.ps1` và `install-task.ps1` dùng đúng tên và thư mục này.
 */
export const OFF_FLAG_NAME = 'disabled.flag'

/** Ghi cờ "đã tắt" vào `dataDir`. Ném lỗi nếu không ghi được (để không báo "đã tắt" khi chưa tắt). */
export function writeOffFlag(dataDir: string): string {
  const file = path.join(dataDir, OFF_FLAG_NAME)
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(file, `${new Date().toISOString()}\n`, 'utf8')
  return file
}

/** Đường dẫn file cấu hình đang dùng (cùng quy tắc với `loadConfig`). */
export function configFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const dataDir = env.AZ_GW_DATA ?? defaultDataDir()
  return env.AZ_GW_CONFIG ?? path.join(dataDir, 'config.json')
}

/**
 * Ghi các trường sửa được vào file cấu hình, giữ nguyên các khóa khác (port, dataDir, logLevel...).
 * Ghi vào file tạm rồi đổi tên để mất điện giữa chừng không làm hỏng file.
 */
export function saveEditableConfig(
  patch: EditableConfig,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const file = configFilePath(env)
  let current: Record<string, unknown> = {}
  if (existsSync(file)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
      if (typeof parsed === 'object' && parsed !== null) current = parsed as Record<string, unknown>
    } catch {
      throw new Error(`File cấu hình ${file} đang hỏng JSON, hãy sửa hoặc xóa trước`)
    }
  }
  const next = {
    ...current,
    cloudUrl: patch.cloudUrl,
    cloudFallbackUrl: patch.cloudFallbackUrl ?? '',
    vps: patch.vps,
    idleFlushSec: patch.idleFlushSec,
  }
  if (patch.cloudToken !== '') (next as Record<string, unknown>).cloudToken = patch.cloudToken
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  renameSync(tmp, file)
}
