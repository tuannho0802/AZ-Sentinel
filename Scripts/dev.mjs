// Khởi chạy cả bốn dịch vụ dev (BE, Server, FE, Gateway), chờ từng cổng sẵn sàng, in bảng tóm tắt rồi
// tự mở các trang kiểm tra trên trình duyệt. Dùng: pnpm dev   (tắt tự mở: AZ_DEV_OPEN=0 pnpm dev)
import { spawn } from 'node:child_process'

const SYNC_TOKEN = process.env.AZ_SYNC_TOKEN ?? 'dev-sync-token-0123456789abcdef'
const URLS = {
  fe: 'http://localhost:5173/',
  server: 'http://127.0.0.1:8080/api/health',
  be: 'http://127.0.0.1:8787/api/health',
  gateway: 'http://127.0.0.1:47800/',
}
const openPages = process.env.AZ_DEV_OPEN !== '0'

const child = spawn(
  'pnpm',
  [
    '--parallel',
    '--filter',
    '@az-sentinel/api',
    '--filter',
    '@az-sentinel/server',
    '--filter',
    '@az-sentinel/web',
    '--filter',
    '@az-sentinel/gateway',
    'dev',
  ],
  { stdio: 'inherit', shell: process.platform === 'win32' },
)
child.on('exit', (code) => process.exit(code ?? 0))
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getJson(url, headers) {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(2000) })
    if (!res.ok) return null
    return await res.json().catch(() => ({}))
  } catch {
    return null
  }
}

async function waitFor(fn, timeoutMs) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const v = await fn()
    if (v) return v
    await sleep(1000)
  }
  return null
}

function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]]
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true })
      .on('error', () => {})
      .unref()
  } catch {
    // không mở được thì bỏ qua: URL đã in ra bảng
  }
}

const [server, be, fe, gw] = await Promise.all([
  waitFor(() => getJson(URLS.server), 90_000),
  waitFor(() => getJson(URLS.be), 90_000),
  waitFor(
    () => getJson(URLS.fe.replace('localhost', '127.0.0.1')).then((j) => j ?? fetchOk(URLS.fe)),
    90_000,
  ),
  waitFor(async () => {
    const st = await getJson('http://127.0.0.1:47800/v1/status')
    return st?.cloud?.connected ? st : null
  }, 90_000),
])

async function fetchOk(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok ? {} : null
  } catch {
    return null
  }
}

// Gateway nối VPS (chính) hay BE (dự phòng): hỏi Server xem đang có Gateway nào nối vào không.
const self = server
  ? await getJson('http://127.0.0.1:8080/api/server-info/self', {
      Authorization: `Bearer ${SYNC_TOKEN}`,
    })
  : null
const gwTarget = !gw
  ? 'CHƯA nối cloud'
  : self && self.gateways > 0
    ? 'đã nối cloud (chính)'
    : 'đang ở dự phòng (BE 8787), Server chưa thấy Gateway'
const mark = (ok) => (ok ? '✔' : '✘')

console.log(`
┌──────────────────────────────────────────────────────────────────────┐
│ AZ Sentinel dev                                                      │
├──────────────────────────────────────────────────────────────────────┤
│ ${mark(server)} Server   đang nghe 127.0.0.1:8080   ${URLS.server}
│ ${mark(be)} BE       Ready on http://127.0.0.1:8787   ${URLS.be}
│ ${mark(fe)} FE       Local: http://localhost:5173   ${URLS.fe}
│ ${mark(gw)} Gateway  ${gwTarget}   ${URLS.gateway}
├──────────────────────────────────────────────────────────────────────┤
│ Đăng nhập thử: admin@az.local / admin1234                            │
│ Ctrl+C để tắt tất cả. Tắt tự mở trang: AZ_DEV_OPEN=0 pnpm dev        │
└──────────────────────────────────────────────────────────────────────┘
`)

if (openPages) {
  for (const [ok, url] of [
    [fe, URLS.fe],
    [gw, URLS.gateway],
    [server, URLS.server],
    [be, URLS.be],
  ]) {
    if (ok) {
      openBrowser(url)
      await sleep(400)
    }
  }
}
