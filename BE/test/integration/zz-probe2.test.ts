import { env } from 'cloudflare:workers'
import { type GwServerMessage, terminalId } from '@az-sentinel/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app'
import { encodeGwToken, GW_HEADER, GW_TOKEN_HEADER } from '../../src/live/gw-header'
import { HUB_NAME } from '../../src/live/routes/live-ws'
import { LOGIN, resetDb, SERVER, seedLink, seedUser, setOwner, TEST_PASSWORD } from '../helpers'
const app = createApp()
const bindings = { DB: env.DB, LIVE_HUB: env.LIVE_HUB }
const TID = terminalId(LOGIN, SERVER)
const call = (method: string, path: string, cookie: string | null, body?: unknown) =>
    app.fetch(new Request(`http://az.test/api${path}`, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) }), bindings)
const until = async (fn: () => boolean, ms = 1500) => { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 10)) } }
beforeEach(resetDb)
describe('race', () => {
    it('double trade', async () => {
        await seedUser('root@az.test', { role: 'root_admin' })
        const owner = await seedUser('a@az.test')
        const l = await seedLink(); await setOwner(l.id, owner.id)
        const login = async (e: string) => ((await call('POST', '/auth/login', null, { email: e, password: TEST_PASSWORD })).headers.get('Set-Cookie') ?? '').split(';')[0] ?? ''
        const root = await login('root@az.test')
        await call('POST', `/links/${l.id}/trade-enabled`, root, { enabled: true })
        const hub = env.LIVE_HUB.getByName(HUB_NAME)
        const res = await hub.fetch(new Request('http://hub/', { headers: { Upgrade: 'websocket', [GW_HEADER]: '1', [GW_TOKEN_HEADER]: encodeGwToken(1, owner.id) } }))
        const ws = res.webSocket!; const msgs: GwServerMessage[] = []
        ws.accept(); ws.addEventListener('message', (e) => { const t = String(e.data); if (t !== 'pong') msgs.push(JSON.parse(t)) })
        ws.send(JSON.stringify({ t: 'hello', v: 1, gw_ver: '0.3.4' }))
        ws.send(JSON.stringify({ t: 'bind', tid: TID, key: l.key, login: LOGIN, server: SERVER, mode: 'demo' }))
        await until(() => msgs.some((m) => m.t === 'bound'))
        ws.send(JSON.stringify({ t: 'state', tid: TID, online: true, snap: { bal: 1, eq: 1, fl: 0, ml: null } }))
        await new Promise((r) => setTimeout(r, 60))
        const body = { op: 'market', symbol: 'XAUUSD', side: 'buy', volume: 1, sl: 0, tp: 0 }
        const [a, b] = await Promise.all([call('POST', `/links/${l.id}/trade`, root, body), call('POST', `/links/${l.id}/trade`, root, body)])
        await new Promise((r) => setTimeout(r, 80))
        const rows = await env.DB.prepare('SELECT status, reason FROM trade_log').all()
        console.log('RACE', a.status, b.status, JSON.stringify(await b.clone().text()).slice(0, 120), 'rows', JSON.stringify(rows.results), 'tradeMsgs', msgs.filter((m) => m.t === 'trade').length)
        ws.close(1000)
    })
})