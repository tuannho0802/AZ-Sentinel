/**
 * Giả lập EA gửi dữ liệu (P1-16). Dùng:
 *   pnpm fake-ea                                  # chạy các tình huống, kiểm tra kết quả
 *   pnpm fake-ea -- --url https://xxx.workers.dev --key <API_KEY>
 *   pnpm fake-ea -- --load 100 --delay-ms 500     # P1-22: 100 heartbeat rải rác
 * Thoát mã 1 nếu có tình huống không đúng kỳ vọng (dùng được như smoke test).
 * Khóa lấy từ --key, biến AZ_API_KEY, hoặc BE/.wrangler/local-api-key.txt (do seed tạo).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { type IngestPayload, ingestPayloadSchema } from '../Shared/src/index'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function loadKey(): string {
  const fromArg = arg('key') ?? process.env.AZ_API_KEY
  if (fromArg) return fromArg
  try {
    return readFileSync(path.join(root, 'BE', '.wrangler', 'local-api-key.txt'), 'utf8').trim()
  } catch {
    console.error('Không có API key. Chạy `pnpm db:seed:local` hoặc truyền --key.')
    process.exit(1)
  }
}

const baseUrl = (arg('url') ?? 'http://127.0.0.1:8787').replace(/\/$/, '')
const apiKey = loadKey()
const login = Number(arg('login') ?? 12345678)
const server = arg('server') ?? 'Broker-Live01'
const sid = Math.random().toString(16).slice(2, 8)
let seq = 0
// Mỗi tình huống m5_bar dùng một nến M5 khác (trong 7 ngày gần nhất, server chấp nhận) để
// chạy lại nhiều lần trong 5 phút vẫn cho số dòng ghi ổn định.
let barSlot = 1 + Math.floor(Math.random() * 900)
const freshBarTs = () => {
  barSlot += 1
  return Math.floor(Date.now() / 1000 / 300) * 300 - barSlot * 300
}

function payload(over: Partial<IngestPayload> = {}, accountOver: Record<string, unknown> = {}) {
  seq += 1
  return ingestPayloadSchema.parse({
    v: 1,
    sid,
    seq,
    reason: ['heartbeat'],
    ts_utc: Math.floor(Date.now() / 1000),
    vps: 'fake-vps',
    ea_ver: 'fake-0.1',
    account: {
      login,
      server,
      broker: 'Fake Broker',
      name: 'Fake Account',
      currency: 'USD',
      balance: 10000,
      equity: 10050.5,
      floating_pl: 50.5,
      margin_level: null,
      ...accountOver,
    },
    ...over,
  })
}

type Result = { status: number; rows: number | null; duplicate: boolean; code: string | null }

async function send(body: unknown, key = apiKey): Promise<Result> {
  const res = await fetch(`${baseUrl}/api/ea/v1/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
    body: JSON.stringify(body),
  })
  const json = (await res.json().catch(() => ({}))) as {
    meta?: { rows_written: number }
    duplicate?: boolean
    error?: { code: string }
  }
  return {
    status: res.status,
    rows: json.meta?.rows_written ?? null,
    duplicate: json.duplicate === true,
    code: json.error?.code ?? null,
  }
}

const closeEvent = {
  kind: 'close' as const,
  deal_ticket: 2,
  position_id: 5001,
  symbol: 'XAUUSD',
  type: 'buy' as const,
  volume: 0.1,
  time: Math.floor(Date.now() / 1000),
  price: 4020.5,
  profit: 10.38,
}

async function runLoad(count: number, delayMs: number) {
  const tally = new Map<number, number>()
  for (let i = 0; i < count; i++) {
    const r = await send(payload())
    tally.set(r.status, (tally.get(r.status) ?? 0) + 1)
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }
  console.log('Kết quả theo mã HTTP:', Object.fromEntries(tally))
  process.exit(tally.size === 1 && tally.has(200) ? 0 : 1)
}

const loadCount = arg('load')
if (loadCount) await runLoad(Number(loadCount), Number(arg('delay-ms') ?? 500))

type Scenario = {
  name: string
  run: () => Promise<Result>
  expectStatus: number
  /** Số dòng ghi kỳ vọng; bỏ qua nếu undefined. Ở prod (không có meta) bỏ qua tự động. */
  expectRows?: number
  expectDuplicate?: boolean
}

// Tạo lúc chạy (không phải lúc nạp module) để seq đúng thứ tự gửi; giữ lại để gửi trùng.
let m5Close: IngestPayload | undefined
const buildM5Close = () => {
  m5Close = payload({
    reason: ['m5_bar', 'trade_event'],
    ts_utc: freshBarTs(),
    events: [closeEvent],
  })
  return m5Close
}

const scenarios: Scenario[] = [
  { name: 'gắn tài khoản lần đầu (heartbeat)', run: () => send(payload()), expectStatus: 200 },
  { name: 'heartbeat', run: () => send(payload()), expectStatus: 200, expectRows: 1 },
  {
    name: 'm5_bar',
    run: () => send(payload({ reason: ['m5_bar'], ts_utc: freshBarTs() })),
    expectStatus: 200,
    expectRows: 2,
  },
  {
    name: 'm5_bar + 1 sự kiện đóng lệnh',
    run: () => send(buildM5Close()),
    expectStatus: 200,
    expectRows: 3,
  },
  {
    name: 'gửi trùng seq',
    run: () => send(m5Close ?? buildM5Close()),
    expectStatus: 200,
    expectRows: 0,
    expectDuplicate: true,
  },
  { name: 'sai API key', run: () => send(payload(), 'khoa-sai'), expectStatus: 401 },
  {
    name: 'sai (server, login)',
    run: () => send(payload({}, { login: login + 1 })),
    expectStatus: 409,
  },
]

let failed = 0
console.log(`Đích: ${baseUrl}\n`)
console.log('Tình huống'.padEnd(36), 'HTTP', 'Ghi', 'Trùng', 'Kết quả')
for (const s of scenarios) {
  const r = await s.run()
  const rows = r.rows ?? (r.duplicate ? 0 : null)
  const problems: string[] = []
  if (r.status !== s.expectStatus) problems.push(`HTTP ${r.status} ≠ ${s.expectStatus}`)
  if (s.expectRows !== undefined && r.rows !== null && rows !== s.expectRows) {
    problems.push(`ghi ${rows} ≠ ${s.expectRows}`)
  }
  if (s.expectDuplicate !== undefined && r.duplicate !== s.expectDuplicate) {
    problems.push('cờ duplicate sai')
  }
  if (problems.length > 0) failed += 1
  console.log(
    s.name.padEnd(36),
    String(r.status).padEnd(4),
    String(rows ?? '-').padEnd(3),
    String(r.duplicate).padEnd(5),
    problems.length === 0 ? 'ĐẠT' : `LỆCH: ${problems.join('; ')}`,
  )
}
console.log(failed === 0 ? '\nTất cả đạt.' : `\n${failed} tình huống lệch kỳ vọng.`)
process.exit(failed === 0 ? 0 : 1)
