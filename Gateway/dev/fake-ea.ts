/**
 * Giả lập một EA (không cần MT5) để thử Gateway. Gọi đúng giao thức loopback như EA thật:
 * ping mỗi 5 giây; khi Gateway báo watch:true thì gửi samples mỗi interval_ms.
 *   pnpm --filter @az-sentinel/gateway fake-ea -- --key <API_KEY> [--login 123] [--server Demo] [--port 47800]
 * Gõ `t` + Enter để bắn một sự kiện đóng lệnh; `q` để thoát.
 */
import { createInterface } from 'node:readline'

const arg = (n: string, d: string) => {
  const i = process.argv.indexOf(`--${n}`)
  return i >= 0 ? (process.argv[i + 1] ?? d) : d
}
const key = arg('key', '')
if (!key) {
  console.error('Thiếu --key <API_KEY>')
  process.exit(1)
}
const login = Number(arg('login', '12345678'))
const server = arg('server', 'Fake-Demo')
const base = `http://127.0.0.1:${arg('port', '47800')}`
const sid = Math.random().toString(16).slice(2, 10)
const ident = { v: 1, sid, key, login, server }
let eq = 10_000
let watch = false
let intervalMs = 2000
let sampSeq = 0
let evSeq = 0

const post = async (path: string, body: unknown) => {
  const r = await fetch(base + path, { method: 'POST', body: JSON.stringify(body) })
  return (await r.json()) as Record<string, unknown>
}
const round2 = (x: number) => Math.round(x * 100) / 100
const snap = () => ({ bal: 10_000, eq: round2(eq), margin: 0, fl: round2(eq - 10_000), ml: null })

async function doPing() {
  try {
    const r = await post('/v1/ping', {
      ...ident,
      ea_ver: 'fake-0.2',
      mode: 'demo',
      conn: true,
      snap: snap(),
    })
    if (r.watch !== watch) console.log(`[ea] watch=${r.watch} bind=${r.bind}`)
    watch = r.watch === true
    intervalMs = Number(r.interval_ms ?? 2000)
  } catch {
    console.log('[ea] Gateway không trả lời')
    watch = false
  }
}

setInterval(() => {
  eq += (Math.random() - 0.5) * 4
}, 1000)

setTimeout(function loop() {
  void doPing().then(() => setTimeout(loop, 5000))
}, Math.random() * 1000)

setTimeout(function live() {
  const next = () => setTimeout(live, intervalMs)
  if (!watch) {
    next()
    return
  }
  const t = Math.floor(Date.now() / 1000)
  const samples = [t - 1, t].map((x) => ({
    t: x,
    eq: round2(eq),
    bal: 10_000,
    fl: round2(eq - 10_000),
    ml: null,
  }))
  sampSeq++
  post('/v1/samples', { ...ident, seq: sampSeq, samples }).then((r) => {
    watch = r.watch === true
    next()
  }, next)
}, 2000)

createInterface({ input: process.stdin }).on('line', async (l) => {
  if (l.trim() === 'q') process.exit(0)
  if (l.trim() !== 't') return
  evSeq++
  const r = await post('/v1/event', {
    ...ident,
    seq: evSeq,
    reason: ['trade_event'],
    events: [
      {
        kind: 'close',
        deal_ticket: 1000 + evSeq,
        position_id: 500 + evSeq,
        symbol: 'EURUSD',
        type: 'buy',
        volume: 0.1,
        time: Math.floor(Date.now() / 1000),
        price: 1.1,
        profit: 3.5,
      },
    ],
    snap: snap(),
  })
  console.log('[ea] event ->', JSON.stringify(r))
})
console.log(`[ea] ${login}@${server} sid=${sid} -> ${base}  (t = bắn sự kiện, q = thoát)`)
