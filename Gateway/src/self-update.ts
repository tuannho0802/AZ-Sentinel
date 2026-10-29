import { createHash } from 'node:crypto'
import {
  closeSync,
  createWriteStream,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { compareVersions, gatewayAssetUrl, isReleaseVersion } from '@az-sentinel/shared'
import type { Logger } from './log'

/**
 * Tự cập nhật Gateway theo lệnh của Server (tin `update {min_ver, url, sha256}`).
 *
 * Luồng: Server báo bản mới -> Gateway tải `az-gateway.exe` từ GitHub Releases của dự án vào `az-gateway.exe.new`
 * (kiểm SHA-256) -> thoát bình thường -> `run-gateway.cmd` (người giám sát) thấy `.new` thì đổi tên exe cũ thành `.old`,
 * đặt exe mới vào chỗ cũ rồi chạy. Gateway không tự ghi đè exe đang chạy.
 *
 * An toàn:
 *  - Chỉ nhận đúng địa chỉ `gatewayAssetUrl(min_ver)` (repo của dự án): Server bị chiếm cũng không dẫn Gateway tới host lạ.
 *  - Kiểm SHA-256 và dấu `MZ` trước khi đặt file vào chỗ chờ; sai thì xóa.
 *  - Bản mới phải "khỏe" (chạy đủ HEALTHY_AFTER_MS) mới xóa bản cũ. Chưa khỏe mà thoát 3 lần liên tiếp thì
 *    `run-gateway.cmd` trả bản cũ về và ghi `update-failed.txt`; Gateway không nhận lại phiên bản đó nữa.
 *  - Chỉ chạy khi đã đóng gói (có số phiên bản thật) và đang dưới `run-gateway.cmd` (có người bật lại sau khi thoát).
 */

/** Các tên file này phải khớp `Installer/run-gateway.cmd` và `Installer/az-gateway.iss` ([InstallDelete]). */
export const STAGED_EXE = 'az-gateway.exe.new'
export const STAGED_VER = 'az-gateway.exe.new.ver'
export const TRIAL_FILE = 'az-gateway.exe.trial'
export const OLD_EXE = 'az-gateway.exe.old'
export const UPDATE_FAILED_FILE = 'update-failed.txt'

/** Chạy đủ chừng này ms sau khi khởi động thì coi bản mới là khỏe. */
export const HEALTHY_AFTER_MS = 30_000
/** Exe Gateway (Node SEA) cỡ vài chục MB; trần để không tải vô hạn nếu địa chỉ bị đổi nội dung. */
const MAX_BYTES = 300 * 1024 * 1024
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000
/** Tải hỏng thì chờ chừng này mới thử lại cùng phiên bản (Server nhắc lại mỗi lần Gateway nối lại). */
const RETRY_AFTER_MS = 10 * 60_000
const RESTART_DELAY_MS = 3000

export type SelfUpdateOffer = { min_ver: string; url: string; sha256: string }

export type SelfUpdateResult =
  | 'disabled'
  | 'not-newer'
  | 'untrusted'
  | 'blocked'
  | 'busy'
  | 'cooldown'
  | 'failed'
  | 'staged'

export type SelfUpdaterOptions = {
  /** Phiên bản đang chạy. */
  current: string
  /**
   * Thư mục chứa `az-gateway.exe` đang chạy. null = không thể tự cập nhật (chạy dev, không đóng gói, không phải Windows).
   * Do `main.ts` quyết định để module này không phụ thuộc nền tảng khi kiểm thử.
   */
  appDir: string | null
  /** Thư mục dữ liệu (`%ProgramData%\AZSentinel`): nơi `run-gateway.cmd` ghi `update-failed.txt`. */
  dataDir: string
  /** Chạy dưới `run-gateway.cmd`: chỉ khi đó thoát mới được bật lại bằng exe mới. */
  supervised: boolean
  /** Người dùng tắt tự cập nhật (`autoUpdate: false` hoặc `AZ_GW_AUTO_UPDATE=0`). */
  enabled?: boolean
  log: Logger
  /** Thoát bình thường để người giám sát đặt exe mới và bật lại. */
  restart: () => void
  fetchFn?: typeof fetch
  now?: () => number
  restartDelayMs?: number
  retryAfterMs?: number
}

const SHA256 = /^[0-9a-f]{64}$/

/** Host cuối cùng sau chuyển hướng: GitHub trả về github.com rồi đẩy sang kho file `*.githubusercontent.com`. */
function isGithubHost(host: string): boolean {
  return host === 'github.com' || host.endsWith('.githubusercontent.com')
}

function readTrim(file: string): string | null {
  try {
    return readFileSync(file, 'utf8').trim()
  } catch {
    return null
  }
}

function startsWithMz(file: string): boolean {
  let fd: number | null = null
  try {
    fd = openSync(file, 'r')
    const buf = Buffer.alloc(2)
    return readSync(fd, buf, 0, 2, 0) === 2 && buf[0] === 0x4d && buf[1] === 0x5a
  } catch {
    return false
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

export class SelfUpdater {
  private busy = false
  private restarting = false
  private readonly failedAt = new Map<string, number>()
  private warnedDisabled = false
  private readonly now: () => number

  constructor(private readonly opts: SelfUpdaterOptions) {
    this.now = opts.now ?? Date.now
  }

  /** Có thể tự cập nhật trong môi trường này không. */
  get active(): boolean {
    return (
      this.opts.enabled !== false &&
      this.opts.appDir !== null &&
      this.opts.supervised &&
      isReleaseVersion(this.opts.current)
    )
  }

  /** Xử lý tin `update` từ Server. Không bao giờ ném lỗi: mọi sự cố chỉ ghi log và giữ bản đang chạy. */
  async offer(msg: SelfUpdateOffer): Promise<SelfUpdateResult> {
    const { log } = this.opts
    const appDir = this.opts.appDir
    if (!this.active || appDir === null) {
      if (!this.warnedDisabled) {
        this.warnedDisabled = true
        log.info(
          `Server báo bản Gateway v${msg.min_ver} nhưng Gateway này không tự cập nhật (chạy tay, không đóng gói, tắt tự cập nhật hoặc không dưới run-gateway.cmd)`,
        )
      }
      return 'disabled'
    }
    if (!isReleaseVersion(msg.min_ver) || compareVersions(msg.min_ver, this.opts.current) <= 0) {
      log.debug(`bỏ qua yêu cầu cập nhật v${msg.min_ver}: không mới hơn v${this.opts.current}`)
      return 'not-newer'
    }
    if (msg.url !== gatewayAssetUrl(msg.min_ver) || !SHA256.test(msg.sha256)) {
      log.warn(`bỏ qua yêu cầu cập nhật v${msg.min_ver}: địa chỉ hoặc mã băm không hợp lệ`)
      return 'untrusted'
    }
    const failed = readTrim(path.join(this.opts.dataDir, UPDATE_FAILED_FILE))
    if (failed && isReleaseVersion(failed) && compareVersions(msg.min_ver, failed) <= 0) {
      log.warn(
        `bỏ qua cập nhật v${msg.min_ver}: bản này (hoặc cũ hơn) đã khởi động lỗi và bị trả về. Chờ phiên bản mới hơn v${failed}`,
      )
      return 'blocked'
    }
    if (this.busy || this.restarting) return 'busy'
    const last = this.failedAt.get(msg.min_ver)
    if (last !== undefined && this.now() - last < (this.opts.retryAfterMs ?? RETRY_AFTER_MS)) {
      return 'cooldown'
    }

    this.busy = true
    try {
      const staged = path.join(appDir, STAGED_EXE)
      if (readTrim(path.join(appDir, STAGED_VER)) === msg.min_ver && existsSync(staged)) {
        log.info(`bản v${msg.min_ver} đã tải sẵn, khởi động lại để áp dụng`)
      } else {
        log.info(
          `Server yêu cầu cập nhật Gateway lên v${msg.min_ver} (đang chạy v${this.opts.current}), đang tải`,
        )
        await this.download(msg, appDir)
        log.info(`đã tải và kiểm băm v${msg.min_ver}, khởi động lại để áp dụng`)
      }
      this.scheduleRestart()
      return 'staged'
    } catch (e) {
      this.failedAt.set(msg.min_ver, this.now())
      log.warn(
        `không cập nhật được lên v${msg.min_ver}, giữ bản đang chạy: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`,
      )
      return 'failed'
    } finally {
      this.busy = false
    }
  }

  /**
   * Gọi khi Gateway đã chạy ổn định (sau `HEALTHY_AFTER_MS`): bỏ bản cũ và cờ thử nghiệm để `run-gateway.cmd`
   * không còn tính các lần thoát sau này là "bản mới khởi động lỗi". Cũng dọn file tải dở của lần trước.
   */
  markHealthy(): void {
    const appDir = this.opts.appDir
    if (appDir === null) return
    const trial = path.join(appDir, TRIAL_FILE)
    if (existsSync(trial)) {
      this.opts.log.info(`Gateway v${this.opts.current} đã chạy ổn định sau cập nhật, xóa bản cũ`)
    }
    for (const f of [trial, path.join(appDir, OLD_EXE), `${path.join(appDir, STAGED_EXE)}.part`]) {
      try {
        rmSync(f, { force: true })
      } catch {
        // đang bị khóa: lần chạy sau dọn tiếp
      }
    }
    // Đã chạy bản mới hơn hẳn phiên bản từng lỗi thì không cần nhớ nữa.
    const file = path.join(this.opts.dataDir, UPDATE_FAILED_FILE)
    const failed = readTrim(file)
    if (failed && isReleaseVersion(failed) && compareVersions(this.opts.current, failed) > 0) {
      try {
        rmSync(file, { force: true })
      } catch {
        // bỏ qua
      }
    }
  }

  private scheduleRestart(): void {
    if (this.restarting) return
    this.restarting = true
    const t = setTimeout(() => this.opts.restart(), this.opts.restartDelayMs ?? RESTART_DELAY_MS)
    t.unref?.()
  }

  private async download(msg: SelfUpdateOffer, appDir: string): Promise<void> {
    const doFetch = this.opts.fetchFn ?? fetch
    const part = path.join(appDir, `${STAGED_EXE}.part`)
    const staged = path.join(appDir, STAGED_EXE)
    const verFile = path.join(appDir, STAGED_VER)
    try {
      const res = await doFetch(msg.url, {
        headers: {
          'user-agent': `az-gateway/${this.opts.current}`,
          accept: 'application/octet-stream',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      })
      if (!res.ok || !res.body) {
        await res.body?.cancel()
        throw new Error(`GitHub trả HTTP ${res.status}`)
      }
      if (res.url) {
        let host = ''
        try {
          host = new URL(res.url).hostname
        } catch {
          // để isGithubHost từ chối
        }
        if (!isGithubHost(host)) throw new Error(`bị chuyển hướng tới host lạ: ${host || '?'}`)
      }
      const declared = Number(res.headers.get('content-length') ?? '0')
      if (declared > MAX_BYTES) throw new Error(`file quá lớn (${declared} byte)`)

      const hash = createHash('sha256')
      let size = 0
      const meter = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          size += chunk.length
          if (size > MAX_BYTES) {
            cb(new Error('file vượt trần kích thước'))
            return
          }
          hash.update(chunk)
          cb(null, chunk)
        },
      })
      await pipeline(
        Readable.fromWeb(res.body as unknown as import('node:stream/web').ReadableStream),
        meter,
        createWriteStream(part),
      )

      const got = hash.digest('hex')
      if (got !== msg.sha256) throw new Error('mã băm SHA-256 không khớp, bỏ file vừa tải')
      if (size < 1024 || !startsWithMz(part)) throw new Error('file tải về không phải exe Windows')

      // Ghi nhãn phiên bản trước, exe sau cùng: `run-gateway.cmd` chỉ hành động khi thấy `.new`, lúc đó nhãn đã đủ.
      writeFileSync(verFile, `${msg.min_ver}\n`, 'utf8')
      renameSync(part, staged)
    } catch (e) {
      // Chỉ xóa file tải dở; bản chờ hợp lệ của lần trước (nếu có) giữ nguyên.
      rmSync(part, { force: true })
      throw e
    }
  }
}
