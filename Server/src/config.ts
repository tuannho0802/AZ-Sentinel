import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

/**
 * Cấu hình máy chủ VPS, đọc từ biến môi trường `AZ_*` và (tùy chọn) tệp `server.env` dạng KEY=VALUE
 * (đường dẫn trong `AZ_ENV_FILE`, mặc định `<dataDir>/server.env`). Biến môi trường thắng tệp.
 */
const schema = z.object({
  port: z.number().int().min(1).max(65535).default(8080),
  /** Mặc định chỉ nghe loopback: đi qua Cloudflare Tunnel/reverse proxy. Đặt 0.0.0.0 để mở cho LAN. */
  host: z.string().default('127.0.0.1'),
  dataDir: z.string(),
  dbFile: z.string(),
  /** Thư mục giao diện đã build (FE/dist). Rỗng = không phục vụ giao diện. */
  webDir: z.string().default(''),
  migrationsDir: z.string(),
  name: z.string().max(64),
  location: z.string().max(64).default(''),
  /** Chỉ dev: token Gateway cố định cho người dùng dev (id 1), tự tạo khi `devLinksApi` bật. */
  devGwToken: z.string().default(''),
  /** Bí mật dịch vụ giữa VPS và Worker (cùng giá trị `SYNC_TOKEN` của Worker). */
  syncToken: z.string().default(''),
  /** Địa chỉ Worker API dự phòng, ví dụ https://az-sentinel-api.xxx.workers.dev. Rỗng = tắt đồng bộ. */
  cloudUrl: z.string().default(''),
  /** URL công khai của chính VPS này (hostname tunnel/tên miền), đưa vào mã kết nối Gateway. Rỗng = lấy theo địa chỉ admin đang truy cập. */
  publicUrl: z.string().default(''),
  /** URL công khai của bản dự phòng cho người dùng (hiện ở UI khi VPS mất kết nối). */
  fallbackUrl: z.string().default(''),
  /** "1" = Server tự chạy Quick Tunnel (trycloudflare.com, địa chỉ đổi mỗi lần) và báo địa chỉ mới cho Worker (Plan 3G). */
  quickTunnel: z.string().default(''),
  /** Đường dẫn cloudflared cho Quick Tunnel. Rỗng = `<dataDir>/cloudflared(.exe)`, chưa có thì tự tải. */
  cloudflaredPath: z.string().default(''),
  liveAllowedOrigins: z.string().default(''),
  /** "1" = bật /api/dev/* (quản lý liên kết không đăng nhập; chỉ dùng khi thử). */
  devLinksApi: z.string().default(''),
  liveIntervalSec: z.string().default(''),
  gatePollSec: z.string().default(''),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
})
export type ServerConfig = z.infer<typeof schema>

export function defaultDataDir(): string {
  if (process.platform === 'win32') {
    return path.join(process.env.ProgramData ?? 'C:\\ProgramData', 'AZSentinelServer')
  }
  return path.join(os.homedir(), '.az-sentinel-server')
}

function parseEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    let value = line.slice(eq + 1).trim()
    if (/^(".*"|'.*')$/.test(value)) value = value.slice(1, -1)
    out[line.slice(0, eq).trim()] = value
  }
  return out
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const dataDir = env.AZ_DATA ?? defaultDataDir()
  const envFile = env.AZ_ENV_FILE ?? path.join(dataDir, 'server.env')
  const merged: Record<string, string | undefined> = {
    ...(existsSync(envFile) ? parseEnvFile(envFile) : {}),
    ...env,
  }
  const here = path.dirname(fileURLToPath(import.meta.url))
  const num = (v: string | undefined) => (v === undefined || v === '' ? undefined : Number(v))
  const parsed = schema.safeParse({
    port: num(merged.AZ_PORT),
    host: merged.AZ_HOST || undefined,
    dataDir,
    dbFile: merged.AZ_DB ?? path.join(dataDir, 'az-sentinel.sqlite'),
    webDir: merged.AZ_WEB_DIR ?? (existsSync(path.join(here, 'web')) ? path.join(here, 'web') : ''),
    migrationsDir: merged.AZ_MIGRATIONS_DIR ?? path.join(here, 'migrations'),
    name: (merged.AZ_SRV_NAME || os.hostname()).slice(0, 64),
    location: merged.AZ_SRV_LOCATION || undefined,
    devGwToken: merged.AZ_DEV_GW_TOKEN || undefined,
    syncToken: merged.AZ_SYNC_TOKEN || undefined,
    cloudUrl: merged.AZ_CLOUD_URL || undefined,
    fallbackUrl: merged.AZ_FALLBACK_URL || undefined,
    publicUrl: merged.AZ_PUBLIC_URL || undefined,
    quickTunnel: merged.AZ_QUICK_TUNNEL || undefined,
    cloudflaredPath: merged.AZ_CLOUDFLARED || undefined,
    liveAllowedOrigins: merged.AZ_LIVE_ALLOWED_ORIGINS || undefined,
    devLinksApi: merged.AZ_DEV_LINKS_API || undefined,
    liveIntervalSec: merged.AZ_LIVE_INTERVAL_SEC || undefined,
    gatePollSec: merged.AZ_GATE_POLL_SEC || undefined,
    logLevel: merged.AZ_LOG || undefined,
  })
  if (!parsed.success) {
    const i = parsed.error.issues[0]
    throw new Error(`Cấu hình không hợp lệ: ${i?.path.join('.')} ${i?.message}`)
  }
  const cfg = parsed.data
  // Plan 3H: Quick Tunnel đổi địa chỉ mỗi lần nên mã kết nối Gateway phải mang địa chỉ Worker (cố định); không phải
  // đặt AZ_PUBLIC_URL tay. Gateway tự hỏi Worker để tìm tunnel hiện tại và nối thẳng.
  if (cfg.quickTunnel === '1' && cfg.publicUrl === '' && cfg.cloudUrl !== '') {
    try {
      cfg.publicUrl = new URL(cfg.cloudUrl).origin
    } catch {
      // AZ_CLOUD_URL sai định dạng: giữ trống, phần đồng bộ sẽ báo lỗi riêng
    }
  }
  return cfg
}
