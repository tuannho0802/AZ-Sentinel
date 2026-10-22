import { env } from 'cloudflare:workers'
import { SERVED_BY_HEADER, type ServerNode, type SyncTradeRow } from '@az-sentinel/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app'
import type { FetchFn } from '../../src/edge/timed-fetch'
import { resetDb } from '../helpers'

const TOKEN = 'sync-token-0123456789'
const ORIGIN = 'https://vps.test'
const VIEWER = { Cookie: 'az_mock_session=admin@az.local' }
const baseEnv = { DB: env.DB, LIVE_HUB: env.LIVE_HUB, DEV_LINKS_API: '1', SYNC_TOKEN: TOKEN }

const vpsNode: ServerNode = {
    role: 'vps',
    name: 'VPS-MAIN',
    host: 'WIN-ABC',
    os: 'Windows Server 2022',
    arch: 'x64',
    runtime: 'node v22.22.2',
    version: '0.1.0',
    startedAt: 1_700_000_000,
    uptimeSec: 7200,
    cpuCount: 4,
    memTotalMb: 8192,
    memFreeMb: 3000,
    cpuPct: 20,
    location: null,
}

const auth = { Authorization: `Bearer ${TOKEN}` }
const post = (app: ReturnType<typeof createApp>, path: string, body: unknown, headers = auth, e = baseEnv) =>
    app.fetch(
        new Request(`http://az.test${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify(body),
        }),
        e,
    )

const linkRow = (id: number, extra: Record<string, unknown> = {}) => ({
    id,
    owner_id: null,
    login: 1000 + id,
    server: 'Broker-Live01',
    broker: 'Broker',
    name: 'Tester',
    currency: 'USD',
    mode: 'real',
    key_hash: String(id).padStart(64, 'a'),
    key_prefix: 'abcd1234',
    status: 'active',
    bound_at: 10,
    created_at: 5,
    vps_name: null,
    ...extra,
})

const tradeRow = (link_id: number, ticket: number, extra: Partial<SyncTradeRow> = {}): SyncTradeRow => ({
    link_id,
    ticket,
    symbol: 'XAUUSD',
    type: 'buy',
    volume: 0.1,
    open_time: 100,
    open_price: 2000,
    close_time: null,
    close_price: null,
    sl: null,
    tp: null,
    profit: null,
    swap: null,
    commission: null,
    comment: null,
    magic: null,
    ...extra,
})

beforeEach(async () => {
    await resetDb()
    await env.DB.prepare('DELETE FROM server_meta').run()
})

describe('/api/sync: xác thực dịch vụ', () => {
    const app = createApp()

    it('thiếu hoặc sai token: 401; chưa cấu hình token và không dev: 503', async () => {
        expect((await post(app, '/api/sync/apply', {}, {})).status).toBe(401)
        expect((await post(app, '/api/sync/apply', {}, { Authorization: 'Bearer sai' })).status).toBe(401)
        const noToken = { DB: env.DB, LIVE_HUB: env.LIVE_HUB }
        expect((await post(app, '/api/sync/apply', {}, auth, noToken as typeof baseEnv)).status).toBe(503)
    })

    it('lô sai định dạng: 400 nêu đường dẫn trường lỗi', async () => {
        const res = await post(app, '/api/sync/apply', { links: [{ id: 1 }] })
        expect(res.status).toBe(400)
        expect(await res.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } })
    })
})

describe('POST /api/sync/apply', () => {
    const app = createApp()

    it('upsert liên kết giữ nguyên id, gửi lại không nhân đôi, sửa thì cập nhật', async () => {
        expect(await (await post(app, '/api/sync/apply', { links: [linkRow(7), linkRow(8)] })).json()).toEqual({ applied: 2 })
        await post(app, '/api/sync/apply', { links: [linkRow(7, { status: 'disabled', vps_name: 'A8' })] })
        const rows = (await env.DB.prepare('SELECT id, status, vps_name FROM ea_links ORDER BY id').all()).results
        expect(rows).toEqual([
            { id: 7, status: 'disabled', vps_name: 'A8' },
            { id: 8, status: 'active', vps_name: null },
        ])
    })

    it('upsert lệnh theo (link_id, ticket) và xóa lệnh', async () => {
        await post(app, '/api/sync/apply', { trades: [tradeRow(7, 1), tradeRow(7, 2)] })
        await post(app, '/api/sync/apply', {
            trades: [tradeRow(7, 1, { close_time: 200, profit: 12.5 })],
            trades_deleted: [{ link_id: 7, ticket: 2 }],
        })
        const rows = (await env.DB.prepare('SELECT ticket, close_time, profit FROM trades').all()).results
        expect(rows).toEqual([{ ticket: 1, close_time: 200, profit: 12.5 }])
    })

    it('xóa liên kết xóa luôn dữ liệu con; xóa chạy trước nên giao lại (server, login) không vướng', async () => {
        await post(app, '/api/sync/apply', { links: [linkRow(7)], trades: [tradeRow(7, 1)] })
        await env.DB.prepare('INSERT INTO events (link_id, ts, type) VALUES (7, 1, ?)').bind('online').run()
        // liên kết 9 nhận đúng (server, login) của liên kết 7 vừa bị xóa
        const res = await post(app, '/api/sync/apply', {
            links_deleted: [7],
            links: [linkRow(9, { login: 1007 })],
        })
        expect(res.status).toBe(200)
        expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM trades').first<{ n: number }>())?.n).toBe(0)
        expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM events').first<{ n: number }>())?.n).toBe(0)
        expect((await env.DB.prepare('SELECT id FROM ea_links').all()).results).toEqual([{ id: 9 }])
    })

    it('khóa API được đồng bộ đúng để Gateway bind được khi dự phòng', async () => {
        await post(app, '/api/sync/apply', { links: [linkRow(3)] })
        const row = await env.DB.prepare('SELECT key_hash FROM ea_links WHERE id = 3').first<{ key_hash: string }>()
        expect(row?.key_hash).toBe(String(3).padStart(64, 'a'))
    })
})

describe('GET /api/sync/trades (VPS kéo lệnh ghi lúc dự phòng)', () => {
    const app = createApp()
    const pull = (q: string) =>
        app.fetch(new Request(`http://az.test/api/sync/trades?${q}`, { headers: auth }), baseEnv)

    it('chỉ trả lệnh đang mở hoặc mở/đóng sau mốc since, phân trang theo khóa chính', async () => {
        await post(app, '/api/sync/apply', {
            trades: [
                tradeRow(1, 1, { open_time: 10, close_time: 20 }), // cũ, đã đóng: bỏ
                tradeRow(1, 2, { open_time: 10, close_time: 500 }), // đóng sau mốc
                tradeRow(1, 3, { open_time: 600 }), // mở sau mốc, còn mở
                tradeRow(2, 1, { open_time: 10 }), // mở từ trước nhưng còn mở
                tradeRow(2, 2, { open_time: 10, close_time: 30 }), // cũ: bỏ
            ],
        })
        const first = await (await pull('since=400&limit=2')).json<{
            trades: { link_id: number; ticket: number }[]
            next: { link_id: number; ticket: number } | null
        }>()
        expect(first.trades.map((t) => [t.link_id, t.ticket])).toEqual([[1, 2], [1, 3]])
        expect(first.next).toEqual({ link_id: 1, ticket: 3 })
        const second = await (
            await pull(`since=400&limit=2&after_link=${first.next?.link_id}&after_ticket=${first.next?.ticket}`)
        ).json<{ trades: { link_id: number; ticket: number }[]; next: unknown }>()
        expect(second.trades.map((t) => [t.link_id, t.ticket])).toEqual([[2, 1]])
        expect(second.next).toBeNull()
    })

    it('thiếu since: 400', async () => {
        expect((await pull('limit=5')).status).toBe(400)
    })
})

describe('nhịp sống và /api/server-info', () => {
    it('heartbeat chỉ nhận node VPS và được lưu', async () => {
        const app = createApp()
        expect((await post(app, '/api/sync/heartbeat', { node: { ...vpsNode, role: 'cloudflare' }, sentAt: 1 })).status).toBe(400)
        expect((await post(app, '/api/sync/heartbeat', { node: vpsNode, sentAt: 1 })).status).toBe(200)
        const row = await env.DB.prepare("SELECT v FROM server_meta WHERE k = 'primary_node'").first<{ v: string }>()
        expect(JSON.parse(row?.v ?? '{}').name).toBe('VPS-MAIN')
    })

    it('cần đăng nhập mới xem được', async () => {
        const app = createApp()
        const res = await app.fetch(new Request('http://az.test/api/server-info'), baseEnv)
        expect(res.status).toBe(401)
    })

    it('chỉ Cloudflare: chế độ standalone', async () => {
        const app = createApp()
        const res = await app.fetch(new Request('http://az.test/api/server-info', { headers: VIEWER }), baseEnv)
        const body = await res.json<{ mode: string; active: ServerNode; primary: { configured: boolean } }>()
        expect(body.mode).toBe('standalone')
        expect(body.active.role).toBe('cloudflare')
        expect(body.primary.configured).toBe(false)
        expect(res.headers.get(SERVED_BY_HEADER)).toBe('cloudflare')
    })

    const selfBody = {
        node: vpsNode,
        standby: { configured: true, lastSyncAt: 99, pending: 3, lastError: null },
        gateways: 2,
        viewers: 1,
    }

    it('VPS sống: node đang phục vụ là VPS, kèm tình trạng đồng bộ', async () => {
        const seen: string[] = []
        const fetchFn: FetchFn = async (input, init) => {
            seen.push(`${input} ${new Headers(init?.headers).get('Authorization') ?? ''}`)
            const h = { [SERVED_BY_HEADER]: 'vps' }
            return input.endsWith('/api/health')
                ? Response.json({ status: 'ok' }, { headers: h })
                : Response.json(selfBody, { headers: h })
        }
        const app = createApp({ edge: { fetchFn, registry: new Map() } })
        const res = await app.fetch(
            new Request('http://az.test/api/server-info', { headers: VIEWER }),
            { ...baseEnv, VPS_ORIGIN: ORIGIN },
        )
        const body = await res.json<{ mode: string; active: ServerNode; standby: { pending: number }; gateways: number }>()
        expect(body.mode).toBe('primary')
        expect(body.active.name).toBe('VPS-MAIN')
        expect(body.standby.pending).toBe(3)
        expect(body.gateways).toBe(2)
        expect(res.headers.get(SERVED_BY_HEADER)).toBe('vps')
        expect(seen.some((s) => s === `${ORIGIN}/api/server-info/self Bearer ${TOKEN}`)).toBe(true)
    })

    it('VPS sập: chế độ fallback, node Cloudflare phục vụ, vẫn hiện VPS lần cuối từ nhịp sống', async () => {
        const app0 = createApp()
        await post(app0, '/api/sync/heartbeat', { node: vpsNode, sentAt: 1 })
        const fetchFn: FetchFn = async () => {
            throw new Error('down')
        }
        const app = createApp({ edge: { fetchFn, registry: new Map() } })
        const res = await app.fetch(
            new Request('http://az.test/api/server-info', { headers: VIEWER }),
            { ...baseEnv, VPS_ORIGIN: ORIGIN },
        )
        const body = await res.json<{
            mode: string
            active: ServerNode
            primary: { status: string; info: ServerNode | null; lastSeenAt: number | null }
        }>()
        expect(body.mode).toBe('fallback')
        expect(body.active.role).toBe('cloudflare')
        expect(body.primary.status).toBe('down')
        expect(body.primary.info?.name).toBe('VPS-MAIN')
        expect(body.primary.lastSeenAt).toBeGreaterThan(0)
        expect(res.headers.get(SERVED_BY_HEADER)).toBe('cloudflare')
    })

    it('/self cần token dịch vụ', async () => {
        const app = createApp()
        const bad = await app.fetch(new Request('http://az.test/api/server-info/self'), baseEnv)
        expect(bad.status).toBe(401)
        const ok = await app.fetch(new Request('http://az.test/api/server-info/self', { headers: auth }), baseEnv)
        expect(ok.status).toBe(200)
        expect((await ok.json<{ node: ServerNode }>()).node.role).toBe('cloudflare')
    })
})