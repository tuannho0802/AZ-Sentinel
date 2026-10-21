import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { CloudClient } from './cloud'
import { defaultDataDir, loadConfig, saveEditableConfig, writeOffFlag } from './config'
import { GATEWAY_VERSION, Gateway } from './gateway'
import { LocalServer, type UiHooks } from './local-server'
import { createFileSink, createLogger } from './log'
import { EventQueue } from './queue'
import { checkForUpdate, type UpdateInfo } from './update-check'

const UPDATE_CHECK_MS = 6 * 3600_000

async function main() {
  const cfg = loadConfig()
  // File log xoay vòng là nơi xem lỗi khi chạy nền; có console thật (chạy tay) thì in thêm ra đó.
  const logDir = path.join(cfg.dataDir, 'logs')
  const log = createLogger(
    cfg.logLevel,
    createFileSink(logDir, { alsoConsole: Boolean(process.stdout.isTTY) }),
  )
  log.info(`AZ Gateway v${GATEWAY_VERSION} khởi động (vps=${cfg.vps})`)

  const queue = new EventQueue(path.join(cfg.dataDir, 'queue.json'))
  const gw = new Gateway({
    vps: cfg.vps,
    queue,
    log,
    cloudConfigured: cfg.cloudUrl !== '',
    idleFlushSec: cfg.idleFlushSec,
  })

  let update: UpdateInfo | null = null
  const runUpdateCheck = () => {
    void checkForUpdate(GATEWAY_VERSION).then((u) => {
      if (u) update = u
      if (u?.available) log.info(`có bản Gateway mới v${u.latest}: ${u.url}`)
    })
  }

  let shuttingDown = false
  const shutdown = async (code = 0) => {
    if (shuttingDown) return
    shuttingDown = true
    log.info('đang dừng Gateway')
    cloud?.stop()
    gw.stop()
    await local.stop()
    process.exit(code)
  }

  // run-gateway.cmd đặt AZ_GW_SUPERVISED=1. Chạy tay hay `pnpm dev` thì không có người giám sát,
  // nên không có "Tắt hoàn toàn" (Ctrl+C là đủ).
  const supervised = process.env.AZ_GW_SUPERVISED === '1'

  const ui: UiHooks = {
    getConfig: () => ({
      vps: cfg.vps,
      cloudUrl: cfg.cloudUrl,
      idleFlushSec: cfg.idleFlushSec,
      tokenSet: cfg.cloudToken !== '',
      port: cfg.port,
      supervised,
    }),
    saveConfig: (c) => saveEditableConfig(c),
    getUpdate: () => update,
    tailLog: (n) => {
      const f = path.join(logDir, 'gateway.log')
      if (!existsSync(f)) return ''
      return readFileSync(f, 'utf8').split('\n').slice(-n).join('\n')
    },
    // Thoát bình thường: run-gateway.cmd (người giám sát) sẽ bật lại với cấu hình mới.
    restart: () => void shutdown(0),
    shutdown: () => {
      if (!supervised) throw new Error('Gateway không chạy dưới run-gateway.cmd')
      const flag = writeOffFlag(cfg.dataDir)
      log.warn(`người dùng tắt hoàn toàn Gateway từ giao diện (cờ: ${flag}); sẽ không tự bật lại`)
      // Chừa thời gian để trả lời HTTP 200 trước khi thoát.
      setTimeout(() => void shutdown(0), 300)
    },
  }
  const local = new LocalServer(gw, cfg.port, log, ui)

  await local.start()
  gw.start()

  let cloud: CloudClient | null = null
  if (cfg.cloudUrl) {
    cloud = new CloudClient(gw, { url: cfg.cloudUrl, token: cfg.cloudToken, log })
    cloud.start()
  } else {
    log.warn('chưa cấu hình cloudUrl: chỉ chạy cục bộ, không có live')
  }

  runUpdateCheck()
  setInterval(runUpdateCheck, UPDATE_CHECK_MS).unref()

  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e)
  console.error(msg)
  // Chạy nền không có console: ghi lỗi khởi động ra file để còn biết vì sao dừng (cấu hình hỏng, cổng bận...).
  try {
    const dir = process.env.AZ_GW_DATA ?? defaultDataDir()
    mkdirSync(dir, { recursive: true })
    appendFileSync(path.join(dir, 'startup-error.txt'), `${new Date().toISOString()} ${msg}\n`)
  } catch {
    // bỏ qua
  }
  process.exit(1)
})
