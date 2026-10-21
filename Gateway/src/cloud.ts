import { GW, gwServerMessageSchema } from '@az-sentinel/shared'
import type { Gateway } from './gateway'
import { type Logger, silentLogger } from './log'

export type CloudOptions = {
    url: string
    log?: Logger
    /** Chỉ để kiểm thử: nhân bản bộ ngẫu nhiên cho jitter. */
    random?: () => number
    /** Chỉ để kiểm thử: rút ngắn khoảng ping và hạn im lặng (ms). */
    pingMs?: number
    silentMs?: number
}

/**
 * Một WebSocket bền từ Gateway ra `LiveHub` (Plan 3C mục 4). Nối lại theo backoff 1, 2, 4...
 * tối đa 60 giây có jitter. Giữ nhịp bằng tin văn bản "ping": hub đáp "pong" tự động bằng
 * `setWebSocketAutoResponse` nên không đánh thức Durable Object (không tính phí request).
 * Quá `silentMs` không nhận được gì (kể cả pong) thì coi là chết và nối lại.
 */
export class CloudClient {
    private ws: WebSocket | null = null
    private attempt = 0
    private stopped = false
    private retryTimer: NodeJS.Timeout | null = null
    private pingTimer: NodeJS.Timeout | null = null
    private lastRx = 0
    private readonly log: Logger
    private readonly rand: () => number
    private readonly pingMs: number
    private readonly silentMs: number

    constructor(
        private readonly gw: Gateway,
        private readonly opts: CloudOptions,
    ) {
        this.log = opts.log ?? silentLogger
        this.rand = opts.random ?? Math.random
        this.pingMs = opts.pingMs ?? GW.wsPingSec * 1000
        this.silentMs = opts.silentMs ?? GW.wsPingSec * 2.5 * 1000
    }

    start(): void {
        this.stopped = false
        this.connect()
    }

    stop(): void {
        this.stopped = true
        if (this.retryTimer) clearTimeout(this.retryTimer)
        if (this.pingTimer) clearInterval(this.pingTimer)
        this.retryTimer = this.pingTimer = null
        const ws = this.ws
        this.ws = null
        if (ws) {
            this.gw.onCloudClose()
            ws.close(1000, 'gateway stopping')
        }
    }

    private connect(): void {
        if (this.stopped) return
        let ws: WebSocket
        try {
            ws = new WebSocket(this.opts.url)
        } catch (e) {
            this.log.error(`URL cloud không hợp lệ: ${e instanceof Error ? e.message : String(e)}`)
            return
        }
        this.ws = ws

        ws.addEventListener('open', () => {
            this.attempt = 0
            this.lastRx = Date.now()
            this.log.info('đã nối cloud')
            this.gw.onCloudOpen((msg) => {
                if (this.ws !== ws || ws.readyState !== WebSocket.OPEN) return false
                ws.send(JSON.stringify(msg))
                return true
            })
            this.pingTimer = setInterval(() => this.keepAlive(ws), this.pingMs)
            this.pingTimer.unref?.()
        })

        ws.addEventListener('message', (ev) => {
            this.lastRx = Date.now()
            if (typeof ev.data !== 'string' || ev.data === 'pong') return
            let json: unknown
            try {
                json = JSON.parse(ev.data)
            } catch {
                return
            }
            const parsed = gwServerMessageSchema.safeParse(json)
            if (parsed.success) this.gw.onCloudMessage(parsed.data)
            else this.log.warn('bỏ qua tin cloud không hợp lệ')
        })

        ws.addEventListener('close', () => this.onClosed(ws))
        ws.addEventListener('error', () => {
            // `close` luôn theo sau `error`; xử lý ở đó để không lên lịch nối lại hai lần.
        })
    }

    private keepAlive(ws: WebSocket): void {
        if (this.ws !== ws) return
        if (Date.now() - this.lastRx > this.silentMs) {
            this.log.warn('cloud im lặng quá lâu, nối lại')
            ws.close(4000, 'silent')
            return
        }
        if (ws.readyState === WebSocket.OPEN) ws.send('ping')
    }

    private onClosed(ws: WebSocket): void {
        if (this.ws !== ws) return // kết nối cũ đã bị thay hoặc dừng chủ động
        this.ws = null
        if (this.pingTimer) clearInterval(this.pingTimer)
        this.pingTimer = null
        this.gw.onCloudClose()
        if (this.stopped) return
        const base = Math.min(GW.reconnectMaxSec, GW.reconnectMinSec * 2 ** this.attempt)
        const delay = Math.round(base * 1000 * (0.5 + this.rand() * 0.5))
        this.attempt++
        this.log.warn(`mất cloud, nối lại sau ${delay}ms (lần ${this.attempt})`)
        this.retryTimer = setTimeout(() => this.connect(), delay)
    }
}