import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Logger } from './log'

const URL_RE = /https:\/\/([a-z0-9-]+)\.trycloudflare\.com/gi

/** Lấy địa chỉ Quick Tunnel từ log của cloudflared (bỏ `api.trycloudflare.com` là máy chủ cấp tunnel). */
export function extractTunnelUrl(text: string): string | null {
  for (const m of text.matchAll(URL_RE)) {
    if (m[1]?.toLowerCase() !== 'api') return m[0].toLowerCase()
  }
  return null
}

const RELEASE = 'https://github.com/cloudflare/cloudflared/releases/latest/download'

/** Tên tệp cloudflared trên trang phát hành; null nếu hệ điều hành này phải tự đặt `AZ_CLOUDFLARED`. */
export function cloudflaredAsset(platform: string = process.platform, arch: string = process.arch) {
  if (platform === 'win32' && arch === 'x64') return 'cloudflared-windows-amd64.exe'
  if (platform === 'linux' && arch === 'x64') return 'cloudflared-linux-amd64'
  if (platform === 'linux' && arch === 'arm64') return 'cloudflared-linux-arm64'
  return null
}

/** Có tệp rồi thì dùng luôn; chưa có thì tải về cạnh dữ liệu (ghi tạm rồi đổi tên để không để lại tệp dở). */
export async function ensureCloudflared(
  file: string,
  fetchFn: typeof fetch = fetch,
  asset: string | null = cloudflaredAsset(),
): Promise<void> {
  if (existsSync(file)) return
  if (!asset)
    throw new Error('hệ điều hành này không có bản cloudflared tự tải: đặt AZ_CLOUDFLARED')
  mkdirSync(path.dirname(file), { recursive: true })
  const res = await fetchFn(`${RELEASE}/${asset}`, { signal: AbortSignal.timeout(120_000) })
  if (!res.ok) throw new Error(`tải cloudflared lỗi HTTP ${res.status}`)
  const tmp = `${file}.part`
  try {
    writeFileSync(tmp, Buffer.from(await res.arrayBuffer()))
    if (process.platform !== 'win32') chmodSync(tmp, 0o755)
    renameSync(tmp, file)
  } finally {
    rmSync(tmp, { force: true })
  }
}

/**
 * Tắt các cloudflared còn sót từ lần chạy trước (Server bị tắt cưỡng bức hoặc VPS reset giữa chừng thì tiến trình
 * con không tự chết). Chỉ tắt đúng tệp `binPath` của mình, không đụng cloudflared dịch vụ Tunnel có tên khác.
 */
export function killStaleCloudflared(binPath: string): void {
  try {
    if (process.platform === 'win32') {
      const esc = binPath.replace(/'/g, "''")
      spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" | Where-Object { $_.ExecutablePath -eq '${esc}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`,
        ],
        { windowsHide: true, timeout: 20_000 },
      )
    } else {
      spawnSync('pkill', ['-f', `${binPath} tunnel`], { timeout: 5_000 })
    }
  } catch {
    // không dọn được thì thôi: tiến trình sót chỉ tốn chút tài nguyên
  }
}

export type QuickTunnelOptions = {
  /** Cổng HTTP của chính Server (tunnel trỏ vào 127.0.0.1:cổng này). */
  port: number
  /** Đường dẫn cloudflared; chưa có thì tải về. */
  binPath: string
  /** Tệp ghi địa chỉ tunnel hiện tại (để người vận hành xem). */
  urlFile: string
  log: Logger
  /** Gọi mỗi khi địa chỉ đổi: chuỗi (đã có địa chỉ mới) hoặc null (tunnel vừa rớt). */
  onChange: (url: string | null) => void
  /** Chỉ để kiểm thử. */
  spawnFn?: typeof spawn
  fetchFn?: typeof fetch
  ensureBin?: (file: string) => Promise<void>
  /** Dọn cloudflared sót từ lần trước, gọi một lần khi bắt đầu. Mặc định `killStaleCloudflared`. */
  killStale?: (binPath: string) => void
  /** Chu kỳ tự kiểm tra tunnel còn thông (ms). Mặc định 60 giây. */
  healthEveryMs?: number
  /** Chờ chừng này sau khi có địa chỉ mới bắt đầu kiểm (tunnel cần chút thời gian mới thông). */
  graceMs?: number
  /** Số lần kiểm hỏng liên tiếp thì khởi động lại cloudflared. */
  maxFails?: number
  /** Thời gian chờ trước lần chạy lại (ms), tăng dần rồi giữ ở mức cuối. */
  backoffMs?: number[]
}

/**
 * Plan 3G: giữ một Quick Tunnel (`*.trycloudflare.com`) luôn chạy cho VPS. Địa chỉ đổi mỗi lần cloudflared
 * chạy lại, nên mỗi khi đổi, `onChange` được gọi để báo cho Worker (cửa trước cố định) biết chuyển tiếp
 * tới đâu. Tự chạy lại khi cloudflared thoát và khi địa chỉ không còn thông tới `/api/health` của chính VPS.
 */
export class QuickTunnel {
  private current: string | null = null
  private proc: ChildProcess | null = null
  private stopped = true
  private timers = new Set<NodeJS.Timeout>()
  private wake: (() => void) | null = null
  private fails = 0
  private urlAt = 0

  constructor(private readonly opts: QuickTunnelOptions) {}

  url(): string | null {
    return this.current
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    void this.loop()
    const every = this.opts.healthEveryMs ?? 60_000
    const t = setInterval(() => void this.check(), every)
    t.unref()
    this.timers.add(t)
  }

  stop(): void {
    this.stopped = true
    for (const t of this.timers) clearInterval(t)
    this.timers.clear()
    this.wake?.()
    this.proc?.kill()
  }

  private async loop(): Promise<void> {
    const delays = this.opts.backoffMs ?? [2_000, 5_000, 15_000, 30_000]
    let attempt = 0
    try {
      ;(this.opts.killStale ?? killStaleCloudflared)(this.opts.binPath)
    } catch {
      // bỏ qua
    }
    while (!this.stopped) {
      const startedAt = Date.now()
      try {
        await (this.opts.ensureBin ?? ((f) => ensureCloudflared(f, this.opts.fetchFn)))(
          this.opts.binPath,
        )
        await this.runOnce()
      } catch (error) {
        this.opts.log.error(`tunnel: ${String(error).slice(0, 200)}`)
      }
      this.setUrl(null)
      if (this.stopped) return
      // Chạy ổn được một lúc thì coi như lỗi mới, không phạt tiếp lần chờ cũ.
      attempt = Date.now() - startedAt > 60_000 ? 0 : attempt + 1
      const wait = delays[Math.min(attempt, delays.length - 1)] ?? 30_000
      this.opts.log.warn(`tunnel: sẽ chạy lại sau ${Math.round(wait / 1000)} giây`)
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, wait)
        this.wake = () => {
          clearTimeout(t)
          resolve()
        }
      })
      this.wake = null
    }
  }

  private runOnce(): Promise<void> {
    return new Promise((resolve, reject) => {
      const run = this.opts.spawnFn ?? spawn
      const proc = run(
        this.opts.binPath,
        ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${this.opts.port}`],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
      )
      this.proc = proc
      this.fails = 0
      const onData = (buf: Buffer) => {
        if (this.current) return
        const found = extractTunnelUrl(buf.toString())
        if (found) this.setUrl(found)
      }
      proc.stdout?.on('data', onData)
      proc.stderr?.on('data', onData)
      proc.on('error', (e) => reject(e))
      proc.on('exit', (code) => {
        this.proc = null
        this.opts.log.warn(`tunnel: cloudflared thoát (mã ${code ?? '?'})`)
        resolve()
      })
    })
  }

  private setUrl(url: string | null): void {
    if (url === this.current) return
    this.current = url
    this.urlAt = url ? Date.now() : 0
    try {
      if (url) writeFileSync(this.opts.urlFile, `${url}\n`)
      else rmSync(this.opts.urlFile, { force: true })
    } catch {
      // ghi tệp phụ lỗi không được làm hỏng tunnel
    }
    this.opts.log.info(url ? `tunnel: địa chỉ hiện tại ${url}` : 'tunnel: đã rớt')
    try {
      this.opts.onChange(url)
    } catch (error) {
      this.opts.log.error(`tunnel: onChange lỗi ${String(error).slice(0, 120)}`)
    }
  }

  /** Địa chỉ phải trả lời `/api/health` của VPS; hỏng nhiều lần liền thì giết cloudflared để chạy lại. */
  private async check(): Promise<void> {
    const url = this.current
    if (!url || Date.now() - this.urlAt < (this.opts.graceMs ?? 30_000)) return
    let ok = false
    try {
      const res = await (this.opts.fetchFn ?? fetch)(`${url}/api/health`, {
        signal: AbortSignal.timeout(10_000),
      })
      ok = res.ok
      await res.body?.cancel()
    } catch {
      ok = false
    }
    if (ok) {
      this.fails = 0
      return
    }
    this.fails += 1
    this.opts.log.warn(`tunnel: kiểm tra hỏng (${this.fails}/${this.opts.maxFails ?? 3})`)
    if (this.fails >= (this.opts.maxFails ?? 3)) {
      this.fails = 0
      this.proc?.kill()
    }
  }
}
