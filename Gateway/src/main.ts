import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { tunnelDirectoryUrl, UPDATE_CHECK_SEC, UPDATE_RETRY_SEC } from '@az-sentinel/shared'
import { runCheckToken } from './check-token'
import { CloudClient } from './cloud'
import { defaultDataDir, loadConfig, saveEditableConfig, writeOffFlag } from './config'
import { runApplyCode, runCheckCode } from './connect-code'
import { loadOrCreateDeviceId, shortCodeOf } from './device-id'
import { GATEWAY_VERSION, Gateway } from './gateway'
import { LocalServer, type UiHooks } from './local-server'
import { createFileSink, createLogger } from './log'
import { EventQueue } from './queue'
import { fetchUpdate, type UpdateInfo } from './update-check'

async function main() {
  const cfg = loadConfig()
  // File log xoay vòng là nơi xem lỗi khi chạy nền; có console thật (chạy tay) thì in thêm ra đó.
  const logDir = path.join(cfg.dataDir, 'logs')
  const log = createLogger(
    cfg.logLevel,
    createFileSink(logDir, {
      alsoConsole: Boolean(process.stdout.isTTY) || process.env.AZ_GW_CONSOLE === '1',
    }),
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

  // Báo bản mới: hỏi GitHub ngay khi khởi động rồi mỗi 5 phút (ETag: không đổi thì chỉ là 304). Lỗi mạng thì thử
  // lại sau 2 phút và ghi log một lần (trước đây nuốt im lặng nên không biết vì sao không có banner).
  // Chạy chưa đóng gói (pnpm dev, không có số phiên bản thật) thì bỏ qua để không báo "có bản mới" vô nghĩa.
  let update: UpdateInfo | null = null
  let updateEtag: string | null = null
  let updateFailure: string | null = null
  let announced: string | null = null
  const canCheckUpdate = Boolean(process.env.GW_BUILD_VERSION)
  const runUpdateCheck = async () => {
    let delaySec = UPDATE_RETRY_SEC
    const r = await fetchUpdate(GATEWAY_VERSION, { etag: updateEtag })
    if (r.kind === 'failed') {
      if (r.reason !== updateFailure) log.warn(`không kiểm tra được bản Gateway mới: ${r.reason}`)
      updateFailure = r.reason
      if (r.fullCycle) delaySec = UPDATE_CHECK_SEC
    } else {
      if (updateFailure !== null) log.info('đã kiểm tra lại được bản Gateway mới')
      updateFailure = null
      delaySec = UPDATE_CHECK_SEC
      if (r.kind === 'updated') {
        update = r.info
        updateEtag = r.etag
        if (r.info?.available && announced !== r.info.latest) {
          announced = r.info.latest
          log.info(`có bản Gateway mới v${r.info.latest}: ${r.info.url}`)
        }
      }
    }
    setTimeout(() => void runUpdateCheck(), delaySec * 1000).unref()
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
      cloudFallbackUrl: cfg.cloudFallbackUrl,
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
    const deviceId = loadOrCreateDeviceId(cfg.dataDir)
    log.info(`mã thiết bị: ${shortCodeOf(deviceId)} (đọc cho quản trị viên nếu cần duyệt thiết bị)`)
    cloud = new CloudClient(gw, {
      url: cfg.cloudUrl,
      ...(cfg.cloudFallbackUrl ? { fallbackUrl: cfg.cloudFallbackUrl } : {}),
      // Plan 3H: Worker là danh bạ tunnel; Gateway tự tìm Quick Tunnel mới của VPS rồi nối thẳng.
      directoryUrls: [cfg.cloudFallbackUrl, cfg.cloudUrl]
        .map((u) => (u ? tunnelDirectoryUrl(u) : null))
        .filter((u): u is string => u !== null),
      token: cfg.cloudToken,
      deviceId,
      log,
    })
    cloud.start()
  } else {
    log.warn('chưa cấu hình cloudUrl: chỉ chạy cục bộ, không có live')
  }

  if (canCheckUpdate) void runUpdateCheck()

  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
}

function fatal(e: unknown) {
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
}

// Bộ cài gọi `az-gateway.exe check-token <url> <token>` để kiểm token rồi thoát (không mở Gateway).
// `check-code <mã>` / `apply-code <mã> [tên-vps]`: cùng mục đích, nhưng nhận mã kết nối một dòng.
if (process.argv[2] === 'check-token') {
  runCheckToken(process.argv.slice(3)).then((code) => process.exit(code), fatal)
} else if (process.argv[2] === 'check-code') {
  runCheckCode(process.argv.slice(3)).then((code) => process.exit(code), fatal)
} else if (process.argv[2] === 'apply-code') {
  try {
    process.exit(runApplyCode(process.argv.slice(3)))
  } catch (e) {
    fatal(e)
  }
} else {
  main().catch(fatal)
}
