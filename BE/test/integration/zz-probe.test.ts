import { env } from 'cloudflare:workers'
import { terminalId } from '@az-sentinel/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app'
import { encodeGwToken, GW_HEADER, GW_TOKEN_HEADER } from '../../src/live/gw-header'
import { HUB_NAME } from '../../src/live/routes/live-ws'
import { LOGIN, resetDb, SERVER, seedLink, seedUser, setOwner, TEST_PASSWORD } from '../helpers'

const app = createApp()
const bindings = { DB: env.DB, LIVE_HUB: env.LIVE_HUB }
const call = (method: string, path: string, cookie: string | null, body?: unknown, headers: Record<string, string> = {}) =>
    app.fetch(new Request(`http://az.test/api${path}`, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), bindings)

beforeEach(resetDb)

describe('probe', () => {
    it('spike', async () => {
        const r = await app.fetch(new Request('http://az.test/api/_spike/hash?iter=1'), bindings)
        console.log('SPIKE', r.status)
    })
    it('login csrf', async () => {
        await seedUser('v@az.test')
        const r = await app.fetch(new Request('http://az.test/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'text/plain;application/json', Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' }, body: JSON.stringify({ email: 'v@az.test', password: TEST_PASSWORD }) }), bindings)
        console.log('LOGINCSRF', r.status, r.headers.get('Set-Cookie')?.slice(0, 30))
        const r2 = await app.fetch(new Request('http://az.test/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ email: 'v@az.test', password: TEST_PASSWORD }) }), bindings)
        console.log('PLAIN', r2.status)
    })
    it('lockout enumeration', async () => {
        await seedUser('victim@az.test')
        const real: number[] = []; const fake: number[] = []
        for (let i = 0; i < 7; i++) real.push((await call('POST', '/auth/login', null, { email: 'victim@az.test', password: 'sai-sai-sai-1' })).status)
        for (let i = 0; i < 7; i++) fake.push((await call('POST', '/auth/login', null, { email: 'nobody@az.test', password: 'sai-sai-sai-1' })).status)
        console.log('REAL', real.join(','), 'FAKE', fake.join(','))
        const ok = await call('POST', '/auth/login', null, { email: 'victim@az.test', password: TEST_PASSWORD })
        console.log('CORRECT_WHILE_LOCKED', ok.status)
    })
    it('long password', async () => {
        await seedUser('v2@az.test')
        const r = await call('POST', '/auth/login', null, { email: 'v2@az.test', password: 'x'.repeat(200_000) })
        console.log('LONGPW', r.status)
        const r3 = await call('POST', '/auth/login', null, { email: '  V2@AZ.TEST ', password: TEST_PASSWORD })
        console.log('EMAILNORM', r3.status)
    })
    it('bearer lowercase', async () => {
        const { token } = await (await import('../helpers')).seedToken(7)
        const r = await app.fetch(new Request('http://az.test/api/gw/check', { headers: { Authorization: `bearer ${token}` } }), bindings)
        console.log('BEARER_LOWER', r.status)
    })
    it('re-enable by owner + origin', async () => {
        await seedUser('root@az.test', { role: 'root_admin' })
        const owner = await seedUser('a@az.test')
        const l = await seedLink(); await setOwner(l.id, owner.id)
        const login = async (e: string) => ((await call('POST', '/auth/login', null, { email: e, password: TEST_PASSWORD })).headers.get('Set-Cookie') ?? '').split(';')[0] ?? ''
        const root = await login('root@az.test'); const user = await login('a@az.test')
        console.log('ADMIN_DISABLE', (await call('POST', `/links/${l.id}/status`, root, { status: 'disabled' })).status)
        console.log('USER_REENABLE', (await call('POST', `/links/${l.id}/status`, user, { status: 'active' })).status)
        const r = await call('POST', `/links/${l.id}/trade-enabled`, root, { enabled: true }, { Origin: 'https://evil.example' })
        console.log('TRADE_ENABLED_EVIL_ORIGIN', r.status)
    })
})