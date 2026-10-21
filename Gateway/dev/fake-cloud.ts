/**
 * Cloud giả để thử Gateway và EA thật trước khi BE có `/api/gw/ws` (patch 08).
 *   pnpm --filter @az-sentinel/gateway fake-cloud            # nghe ws://127.0.0.1:8788/api/gw/ws
 * Phím (gõ rồi Enter):  w = bật/tắt "có người xem" cho mọi terminal · r = từ chối khóa kế tiếp (409)
 *                       s = in trạng thái · q = thoát
 * Tự động: bound cho mọi bind, ack cho mọi event, in từng tin nhận được (rút gọn).
 */
import { createInterface } from 'node:readline'
import { type GwClientMessage, type GwServerMessage, GW } from '@az-sentinel/shared'
import { WebSocketServer } from 'ws'

const port = Number(process.env.PORT ?? 8788)
const wss = new WebSocketServer({ port, host: '127.0.0.1', path: '/api/gw/ws' })
const tids = new Set<string>()
let watching = false
let rejectNext = false
let batches = 0
let samples = 0

const send = (s: import('ws').WebSocket, m: GwServerMessage) => s.send(JSON.stringify(m))
const pushWatch = () => {
    for (const s of wss.clients) send(s, { t: 'watch', tids: watching ? [...tids] : [], push_sec: 2 })
}

wss.on('connection', (s) => {
    console.log('[cloud] Gateway đã nối')
    const bindTimer = setTimeout(() => {
        console.log(`[cloud] chưa bind trong ${GW.bindTimeoutSec}s, đóng kết nối`)
        s.close(4001, 'bind timeout')
    }, GW.bindTimeoutSec * 1000)
    let bound = false

    s.on('close', () => {
        clearTimeout(bindTimer)
        console.log('[cloud] Gateway đã ngắt')
    })
    s.on('message', (raw) => {
        const text = raw.toString()
        if (text === 'ping') return s.send('pong')
        const m = JSON.parse(text) as GwClientMessage
        switch (m.t) {
            case 'hello':
                console.log(`[cloud] hello gw ${m.gw_ver} vps=${m.vps ?? '?'} os=${m.os ?? '?'}`)
                break
            case 'bind':
                console.log(`[cloud] bind ${m.tid} (${m.mode}) khóa=${m.key.slice(0, 4)}…`)
                if (rejectNext) {
                    rejectNext = false
                    send(s, { t: 'reject', tid: m.tid, code: 409 })
                    console.log('[cloud]   -> reject 409')
                    break
                }
                bound = true
                clearTimeout(bindTimer)
                tids.add(m.tid)
                send(s, { t: 'bound', tid: m.tid, link_id: tids.size })
                if (watching) pushWatch()
                break
            case 'state':
                console.log(`[cloud] state ${m.tid} ${m.online ? 'ONLINE' : 'OFFLINE'} eq=${m.snap?.eq ?? '?'}`)
                break
            case 'batch':
                batches++
                for (const i of m.items) samples += i.samples.length
                console.log(
                    `[cloud] batch ${m.items.map((i) => `${i.tid}:${i.samples.length}${i.positions ? `+${i.positions.length}pos` : ''}`).join(' ')}  (tổng ${batches} batch, ${samples} mẫu)`,
                )
                break
            case 'event':
                console.log(
                    `[cloud] event ${m.tid} seq=${m.seq} reason=${m.reason.join(',')} events=${m.events
                        .map((e) => `${e.kind}#${e.position_id}`)
                        .join(',') || '-'}`,
                )
                send(s, { t: 'ack', tid: m.tid, seq: m.seq })
                break
        }
        if (!bound && m.t !== 'hello' && m.t !== 'bind') console.log('[cloud] cảnh báo: tin trước khi bind')
    })
})

wss.on('listening', () => {
    console.log(`[cloud] nghe ws://127.0.0.1:${port}/api/gw/ws   (w = bật/tắt xem · r = từ chối · s = trạng thái · q = thoát)`)
})

createInterface({ input: process.stdin }).on('line', (line) => {
    switch (line.trim()) {
        case 'w':
            watching = !watching
            pushWatch()
            console.log(`[cloud] viewer ${watching ? 'VÀO' : 'RỜI'} (watch ${watching ? tids.size : 0} terminal)`)
            break
        case 'r':
            rejectNext = true
            console.log('[cloud] bind kế tiếp sẽ bị từ chối 409')
            break
        case 's':
            console.log(`[cloud] terminal=${[...tids].join(', ') || '-'} watching=${watching} batch=${batches} mẫu=${samples}`)
            break
        case 'q':
            process.exit(0)
    }
})
EOF
cat > dev / fake - ea.ts << 'EOF'
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
const snap = () => ({ bal: 10_000, eq, margin: 0, fl: Math.round((eq - 10_000) * 100) / 100, ml: null })

async function doPing() {
    try {
        const r = await post('/v1/ping', { ...ident, ea_ver: 'fake-0.2', mode: 'demo', conn: true, snap: snap() })
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
    if (!watch) return void next()
    const t = Math.floor(Date.now() / 1000)
    const samples = [t - 1, t].map((x) => ({ t: x, eq: Math.round(eq * 100) / 100, bal: 10_000, fl: Math.round((eq - 10_000) * 100) / 100, ml: null }))
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
        events: [{ kind: 'close', deal_ticket: 1000 + evSeq, position_id: 500 + evSeq, symbol: 'EURUSD', type: 'buy', volume: 0.1, time: Math.floor(Date.now() / 1000), price: 1.1, profit: 3.5 }],
        snap: snap(),
    })
    console.log('[ea] event ->', JSON.stringify(r))
})
console.log(`[ea] ${login}@${server} sid=${sid} -> ${base}  (t = bắn sự kiện, q = thoát)`)