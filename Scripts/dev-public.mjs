// Chạy Server + web ở máy dev và cho Gateway ở VPS khác nối về, chỉ bằng MỘT lệnh: pnpm dev:public
//   1. Tự có cloudflared (dùng bản trong PATH, nếu không thì tải về .tools/, không cần cài tay).
//   2. Mở Quick Tunnel (miễn phí, không cần tài khoản) và lấy địa chỉ https://xxxx.trycloudflare.com.
//   3. Chạy `pnpm dev` (Server + web, không BE/Gateway local) với AZ_PUBLIC_URL là địa chỉ đó.
//   4. In sẵn MÃ KẾT NỐI azc1... (cũng chép vào clipboard và ghi Server/.dev-data/connect-code.txt):
//      trên VPS chỉ cần chạy AZSentinel-Gateway-Setup.exe và dán mã này.
// An toàn: tunnel KHÔNG trỏ thẳng vào Server mà qua một cổng lọc (8081) chỉ cho đường Gateway
// (/api/gw/ws, /api/gw/check) đi qua. API dev và đăng nhập thử của Server không lộ ra internet.
// Địa chỉ quick tunnel đổi mỗi lần chạy lại: mỗi lần phải dán mã mới trên VPS. Cần địa chỉ cố định thì
// dùng Cloudflare Tunnel có tên (xem Docs/AZ_Sentinel_Plan3E_VPS_Primary.md).
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmodSync, createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SERVER_PORT = 8080
const FILTER_PORT = 8081
// Tunnel này ra internet nên KHÔNG dùng token dev cố định (public trong repo): mỗi lần chạy sinh token ngẫu nhiên.
const DEV_TOKEN = process.env.AZ_DEV_GW_TOKEN ?? `azt_${randomBytes(24).toString('base64url')}`
const ALLOWED = [/^\/api\/gw\/ws(\?|$)/, /^\/api\/gw\/check(\?|$)/]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const cleanups = []

// ------------------------------------------------------------------ cổng lọc
function startFilter() {
  const server = http.createServer((req, res) => {
    if (!ALLOWED.some((re) => re.test(req.url ?? ''))) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not Found')
      return
    }
    const upstream = http.request(
      {
        host: '127.0.0.1',
        port: SERVER_PORT,
        method: req.method,
        path: req.url,
        headers: req.headers,
      },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers)
        up.pipe(res)
      },
    )
    upstream.on('error', () => res.writeHead(502).end('Bad Gateway'))
    req.pipe(upstream)
  })
  server.on('upgrade', (req, socket, head) => {
    if (!ALLOWED.some((re) => re.test(req.url ?? ''))) {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
      return
    }
    const upstream = net.connect(SERVER_PORT, '127.0.0.1', () => {
      let raw = `${req.method} ${req.url} HTTP/1.1\r\n`
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        raw += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`
      }
      upstream.write(`${raw}\r\n`)
      if (head.length > 0) upstream.write(head)
      socket.pipe(upstream).pipe(socket)
    })
    upstream.on('error', () => socket.destroy())
    socket.on('error', () => upstream.destroy())
  })
  server.listen(FILTER_PORT, '127.0.0.1')
  cleanups.push(() => server.close())
  return server
}

// ------------------------------------------------------------------ cloudflared
function findInPath() {
  const probe = spawnSync('cloudflared', ['--version'], { shell: process.platform === 'win32' })
  return probe.status === 0 ? 'cloudflared' : null
}

async function ensureCloudflared() {
  const inPath = findInPath()
  if (inPath) return inPath
  const win = process.platform === 'win32'
  const asset =
    process.platform === 'win32'
      ? 'cloudflared-windows-amd64.exe'
      : process.platform === 'linux'
        ? 'cloudflared-linux-amd64'
        : null
  if (!asset) {
    throw new Error(
      'Chưa tự tải được cloudflared cho hệ điều hành này: hãy cài (brew install cloudflared).',
    )
  }
  const dir = path.join(root, '.tools')
  const file = path.join(dir, win ? 'cloudflared.exe' : 'cloudflared')
  if (existsSync(file)) return file
  mkdirSync(dir, { recursive: true })
  console.log('Đang tải cloudflared (một lần, ~40 MB)...')
  const res = await fetch(
    `https://github.com/cloudflare/cloudflared/releases/latest/download/${asset}`,
  )
  if (!res.ok || !res.body) throw new Error(`Không tải được cloudflared (HTTP ${res.status})`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file))
  if (!win) chmodSync(file, 0o755)
  return file
}

function startTunnel(bin) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      bin,
      ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${FILTER_PORT}`],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: bin === 'cloudflared' && process.platform === 'win32',
      },
    )
    cleanups.push(() => proc.kill())
    const timer = setTimeout(
      () => reject(new Error('cloudflared không trả địa chỉ trong 60 giây')),
      60_000,
    )
    const onData = (buf) => {
      const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(buf.toString())
      if (m) {
        clearTimeout(timer)
        resolve(m[0])
      }
    }
    proc.stdout.on('data', onData)
    proc.stderr.on('data', onData)
    proc.on('error', reject)
    proc.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`cloudflared thoát (mã ${code}) trước khi có địa chỉ`))
    })
  })
}

// ------------------------------------------------------------------ mã kết nối
/** Cùng định dạng với Shared/src/connect-code.ts: azc1.<base64url(JSON {v,u,f,t})>. */
function makeCode(publicUrl) {
  const u = `${publicUrl.replace(/^http/, 'ws')}/api/gw/ws`
  const json = JSON.stringify({ v: 1, u, f: '', t: DEV_TOKEN })
  return `azc1.${Buffer.from(json, 'utf8').toString('base64url')}`
}

function copyToClipboard(text) {
  try {
    if (process.platform === 'win32') spawnSync('clip', { input: text })
    else if (process.platform === 'darwin') spawnSync('pbcopy', { input: text })
    else return false
    return true
  } catch {
    return false
  }
}

async function waitHealthy() {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${SERVER_PORT}/api/health`, {
        signal: AbortSignal.timeout(2000),
      })
      if (res.ok) return true
    } catch {
      // chưa lên
    }
    await sleep(1000)
  }
  return false
}

function stopAll() {
  for (const fn of cleanups.splice(0)) {
    try {
      fn()
    } catch {
      // bỏ qua
    }
  }
}

// ------------------------------------------------------------------ chạy
try {
  startFilter()
  const bin = await ensureCloudflared()
  console.log('Đang mở tunnel công khai...')
  const publicUrl = await startTunnel(bin)
  console.log(`Tunnel: ${publicUrl}`)

  const dev = spawn(process.execPath, [path.join(root, 'Scripts', 'dev.mjs')], {
    stdio: 'inherit',
    env: {
      ...process.env,
      AZ_DEV_GW_TOKEN: DEV_TOKEN,
      AZ_PUBLIC_URL: publicUrl,
      AZ_DEV_NO_GATEWAY: '1',
      AZ_DEV_NO_BE: '1',
      AZ_CLOUD_URL: '',
      AZ_FALLBACK_URL: '',
    },
  })
  cleanups.push(() => dev.kill())
  dev.on('exit', (code) => {
    stopAll()
    process.exit(code ?? 0)
  })
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      stopAll()
      process.exit(0)
    })
  }

  if (await waitHealthy()) {
    const code = makeCode(publicUrl)
    const dataDir = path.join(root, 'Server', '.dev-data')
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(path.join(dataDir, 'connect-code.txt'), `${code}\n`)
    const copied = copyToClipboard(code)
    console.log(`
════════════════════════════════════════════════════════════════════════
 TRÊN VPS (có MT5): chạy AZSentinel-Gateway-Setup.exe, dán mã này, Next.
${copied ? ' (Mã đã được chép vào clipboard.)' : ''}
 ${code}

 Địa chỉ web (máy này):  http://localhost:5173  (admin@az.local / admin1234)
 Mã lưu tại: Server/.dev-data/connect-code.txt
 Địa chỉ tunnel đổi mỗi lần chạy lại: lần sau phải dán mã mới trên VPS.
════════════════════════════════════════════════════════════════════════
`)
  } else {
    console.log('Server chưa trả lời /api/health sau 2 phút: xem log phía trên.')
  }
} catch (e) {
  console.error(`dev:public lỗi: ${e instanceof Error ? e.message : String(e)}`)
  stopAll()
  process.exit(1)
}
