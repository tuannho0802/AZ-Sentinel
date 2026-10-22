import { env } from 'cloudflare:workers'
import type { MeResponse } from '@az-sentinel/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app'
import { LOCK_SEC, MAX_FAILED_LOGINS } from '../../src/services/user-service'
import { resetDb, seedUser, TEST_PASSWORD } from '../helpers'

const app = createApp()
const bindings = { DB: env.DB, LIVE_HUB: env.LIVE_HUB }

function call(method: string, path: string, opts: { cookie?: string; body?: unknown; url?: string } = {}) {
    return app.fetch(
        new Request(`${opts.url ?? 'http://az.test'}/api${path}`, {
            method,
            headers: {
                ...(opts.cookie ? { Cookie: opts.cookie } : {}),
                ...(opts.body === undefined ? {} : { 'Content-Type': 'application/json' }),
            },
            body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        }),
        bindings,
    )
}

const login = (email: string, password = TEST_PASSWORD, url?: string) =>
    call('POST', '/auth/login', { body: { email, password }, url })

function cookieOf(res: Response): string {
    const raw = res.headers.get('Set-Cookie') ?? ''
    return raw.split(';')[0] ?? ''
}

beforeEach(resetDb)

describe('đăng nhập thật (Plan 4B)', () => {
    it('đăng nhập đúng: cookie HttpOnly, /me trả đúng người, không lộ mật khẩu', async () => {
        await seedUser('an@az.test', { name: 'An' })
        const res = await login('AN@az.test')
        expect(res.status).toBe(200)
        const setCookie = res.headers.get('Set-Cookie') ?? ''
        expect(setCookie).toContain('az_session=')
        expect(setCookie).toContain('HttpOnly')
        expect(setCookie).toContain('SameSite=Lax')
        expect(setCookie).not.toContain('Secure')
        const me = await res.json<MeResponse>()
        expect(me).toMatchObject({ email: 'an@az.test', display_name: 'An', role: 'user' })
        expect(JSON.stringify(me)).not.toContain('password')

        const mine = await call('GET', '/me', { cookie: cookieOf(res) })
        expect(mine.status).toBe(200)
        expect((await mine.json<MeResponse>()).email).toBe('an@az.test')
    })

    it('qua HTTPS (hoặc Tunnel báo https) thì cookie có Secure', async () => {
        await seedUser('an@az.test')
        expect((await login('an@az.test', TEST_PASSWORD, 'https://az.test')).headers.get('Set-Cookie')).toContain('Secure')
    })

    it('chưa đăng nhập hoặc cookie rác thì /me 401', async () => {
        expect((await call('GET', '/me')).status).toBe(401)
        expect((await call('GET', '/me', { cookie: 'az_session=khong-phai-phien-that-0123456789' })).status).toBe(401)
    })

    it('đăng xuất xóa phiên: cookie cũ không dùng lại được', async () => {
        await seedUser('an@az.test')
        const cookie = cookieOf(await login('an@az.test'))
        const out = await call('POST', '/auth/logout', { cookie, body: {} })
        expect(out.status).toBe(200)
        expect(out.headers.get('Set-Cookie')).toContain('Max-Age=0')
        expect((await call('GET', '/me', { cookie })).status).toBe(401)
    })

    it('sai mật khẩu và email lạ cùng một thông điệp (không lộ email nào có tài khoản)', async () => {
        await seedUser('an@az.test')
        const wrong = await login('an@az.test', 'sai-mat-khau-het')
        const unknown = await login('khong-co@az.test', 'sai-mat-khau-het')
        expect(wrong.status).toBe(401)
        expect(unknown.status).toBe(401)
        expect(await wrong.text()).toBe(await unknown.text())
    })

    it('sai quá số lần thì khóa tạm, kể cả khi sau đó nhập đúng; gỡ được khi hết hạn khóa', async () => {
        const user = await seedUser('an@az.test')
        for (let i = 0; i < MAX_FAILED_LOGINS; i++) {
            expect((await login('an@az.test', 'sai-mat-khau-het')).status).toBe(401)
        }
        const locked = await login('an@az.test')
        expect(locked.status).toBe(429)
        expect(Number(locked.headers.get('Retry-After'))).toBeGreaterThan(0)
        expect(Number(locked.headers.get('Retry-After'))).toBeLessThanOrEqual(LOCK_SEC)

        await env.DB.prepare('UPDATE users SET locked_until = 1 WHERE id = ?').bind(user.id).run()
        expect((await login('an@az.test')).status).toBe(200)
    })

    it('tài khoản chờ duyệt hoặc bị khóa: 403 chỉ sau khi đúng mật khẩu', async () => {
        await seedUser('cho@az.test', { status: 'pending' })
        await seedUser('khoa@az.test', { status: 'suspended' })
        const pending = await login('cho@az.test')
        expect(pending.status).toBe(403)
        expect((await pending.json<{ error: { message: string } }>()).error.message).toContain('chờ')
        expect((await login('khoa@az.test')).status).toBe(403)
        expect((await login('cho@az.test', 'sai-mat-khau-het')).status).toBe(401)
    })

    it('phiên hết hạn hoặc người dùng bị khóa thì không còn hiệu lực', async () => {
        const user = await seedUser('an@az.test')
        const cookie = cookieOf(await login('an@az.test'))
        await env.DB.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").bind(user.id).run()
        expect((await call('GET', '/me', { cookie })).status).toBe(401)
        await env.DB.prepare("UPDATE users SET status = 'active' WHERE id = ?").bind(user.id).run()
        expect((await call('GET', '/me', { cookie })).status).toBe(200)
        await env.DB.prepare('UPDATE sessions SET expires_at = 1').run()
        expect((await call('GET', '/me', { cookie })).status).toBe(401)
    })

    it('đăng nhập bắt buộc JSON và dữ liệu hợp lệ', async () => {
        const form = await app.fetch(
            new Request('http://az.test/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: '{}',
            }),
            bindings,
        )
        expect(form.status).toBe(400)
        expect((await call('POST', '/auth/login', { body: { email: 'khong-phai-email', password: 'x' } })).status).toBe(400)
    })
})