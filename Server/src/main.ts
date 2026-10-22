import { mkdirSync } from 'node:fs'
import { createApp } from '../../BE/src/app'
import { LiveHub } from '../../BE/src/live/live-hub'
import { ensureDevToken } from '../../BE/src/services/gw-token-service'
import { ensureDevUsers } from '../../BE/src/services/user-service'
import type { Bindings } from '../../BE/src/types'
import { loadConfig } from './config'
import { CpuMeter, createHostHooks, describeNode } from './host'
import { startHttpServer } from './http'
import { createLogger } from './log'
import { runMigrations } from './migrate'
import { ShimState } from './shim/cloudflare-workers'
import { openDatabase } from './shim/d1'
import { createStaticHandler } from './static'
import { SyncAgent } from './sync-agent'
import { runTokenCli } from './token-cli'
import { runUserCli } from './user-cli'

/**
 * Máy chủ VPS (Plan 3E): chạy NGUYÊN BE (Hono) và `LiveHub` trên Node với SQLite thay D1, đồng thời phục
 * vụ giao diện (FE/dist). Đây là node chính; Cloudflare chỉ là dự phòng.
 */
async function main() {
  const cfg = loadConfig()
  // `node server.mjs token <lệnh>`: quản lý token Gateway bằng dòng lệnh rồi thoát (không mở server).
  if (process.argv[2] === 'token') {
    process.exit(await runTokenCli(cfg, process.argv.slice(3)))
  }
  // `node server.mjs user <lệnh>`: tạo admin đầu tiên, liệt kê người dùng, đặt lại mật khẩu rồi thoát.
  if (process.argv[2] === 'user') {
    mkdirSync(cfg.dataDir, { recursive: true })
    process.exit(await runUserCli(cfg, process.argv.slice(3)))
  }
  mkdirSync(cfg.dataDir, { recursive: true })
  const log = createLogger(cfg.logLevel, `${cfg.dataDir}/logs`)
  log.info(`AZ Server v${process.env.AZ_SERVER_VERSION ?? 'dev'} khởi động (${cfg.name})`)

  const db = openDatabase(cfg.dbFile)
  const applied = runMigrations(db, cfg.migrationsDir)
  if (applied.length > 0) log.info(`đã áp migration: ${applied.join(', ')}`)

  // Dev: người dùng dev khớp tài khoản giả lập của FE (id 1 = admin, id 2 = user). Bản thật không có
  // cờ này: admin đầu tiên tạo bằng `user create-admin`.
  if (cfg.devLinksApi === '1') await ensureDevUsers(db as unknown as D1Database)

  // Dev: bảo đảm Gateway dev có token cá nhân cố định (người dùng dev id 1). Bản thật không có cờ này.
  if (cfg.devLinksApi === '1' && cfg.devGwToken !== '') {
    await ensureDevToken(
      db as unknown as D1Database,
      cfg.devGwToken,
      1,
      'dev@az.local',
      Math.floor(Date.now() / 1000),
    )
  }

  const cpu = new CpuMeter()
  cpu.start()

  const canSync = cfg.cloudUrl !== '' && cfg.syncToken !== ''
  if (cfg.cloudUrl !== '' && cfg.syncToken === '') {
    log.warn('có AZ_CLOUD_URL nhưng thiếu AZ_SYNC_TOKEN: tắt đồng bộ sang Cloudflare')
  }
  const sync = canSync
    ? new SyncAgent(db, {
        cloudOrigin: new URL(cfg.cloudUrl).origin,
        token: cfg.syncToken,
        describe: () => describeNode(cfg, cpu),
        log,
      })
    : null
  if (!canSync) log.warn('chưa bật đồng bộ: Cloudflare dự phòng sẽ không có liên kết/lệnh của VPS')

  // Hub live: cùng lớp `LiveHub` của Worker, chạy trên shim Durable Object.
  const state = new ShimState()
  const env: Bindings = {
    DB: db as unknown as D1Database,
    LIVE_HUB: { getByName: () => hub } as unknown as Bindings['LIVE_HUB'],
    SYNC_TOKEN: cfg.syncToken || undefined,
    LIVE_ALLOWED_ORIGINS: cfg.liveAllowedOrigins || undefined,
    DEV_LINKS_API: cfg.devLinksApi || undefined,
    LIVE_INTERVAL_SEC: cfg.liveIntervalSec || undefined,
    GATE_POLL_SEC: cfg.gatePollSec || undefined,
    HOST: createHostHooks(cfg, cpu, () => sync?.status() ?? null),
  }
  const hub = new LiveHub(state as unknown as DurableObjectState, env)
  state.attach(hub as never, (error) => log.error(`hub lỗi: ${String(error).slice(0, 200)}`))

  const app = createApp()
  const serveWeb = cfg.webDir === '' ? null : createStaticHandler(cfg.webDir)
  if (!serveWeb) log.warn('chưa có AZ_WEB_DIR: chỉ phục vụ API, không phục vụ giao diện')

  const handler = (req: Request): Response | Promise<Response> => {
    const { pathname } = new URL(req.url)
    // `/api/sync/*` là đường vào của Cloudflare; VPS là nơi đẩy đi nên không mở đường này.
    if (pathname === '/api/sync' || pathname.startsWith('/api/sync/')) {
      return Response.json(
        { error: { code: 'NOT_FOUND', message: 'Không tìm thấy' } },
        { status: 404 },
      )
    }
    if (pathname === '/api' || pathname.startsWith('/api/')) return app.fetch(req, env)
    return serveWeb ? serveWeb(req) : new Response('Not Found', { status: 404 })
  }

  const server = startHttpServer({
    port: cfg.port,
    host: cfg.host,
    handler,
    onGatewayConnected: () => sync?.nudgePull(),
  })
  server.on('listening', () => log.info(`đang nghe ${cfg.host}:${cfg.port}`))
  server.on('error', (e) => {
    log.error(`không mở được cổng ${cfg.port}: ${String(e)}`)
    process.exit(1)
  })
  sync?.start()

  const shutdown = (signal: string) => {
    log.info(`nhận ${signal}, đang dừng`)
    sync?.stop()
    cpu.stop()
    for (const ws of state.getWebSockets()) ws.close(1001, 'server_restart')
    server.close()
    setTimeout(() => {
      try {
        db.sqlite.close()
      } catch {
        // đã đóng
      }
      process.exit(0)
    }, 500).unref()
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
