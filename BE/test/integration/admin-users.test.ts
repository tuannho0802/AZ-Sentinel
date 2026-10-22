import { env } from 'cloudflare:workers'
import type { GwTokenSecretResponse, UserListResponse, UserResponse } from '@az-sentinel/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app'
import { resetDb, seedUser, TEST_PASSWORD } from '../helpers'

const app = createApp()
const bindings = { DB: env.DB, LIVE_HUB: env.LIVE_HUB }

function call(method: string, path: string, cookie: string | null, body?: unknown) {
    return app.fetch(
        new Request(`http://az.test/api${path}`, {
            method,
            headers: {
                ...(cookie ? { Cookie: cookie } : {}),
                ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        }),
        bindings,
    )
}

async function loginAs(email: string, password = TEST_PASSWORD): Promise<string> {
    const res = await call('POST', '/auth/login', null, { email, password })
    expect(res.status).toBe(200)
    return (res.headers.get('Set-Cookie') ?? '').split(';')[0] ?? ''
}

const NEW_USER = { email: 'Moi@az.test', display_name: 'Người Mới', password: 'mat-khau-moi-123' }

beforeEach(resetDb)

describe('/api/admin/users (Plan 4B)', () => {
    it('chưa đăng nhập 401, người dùng thường 403', async () => {
        await seedUser('u@az.test')
        expect((await call('GET', '/admin/users', null)).status).toBe(401)
        const cookie = await loginAs('u@az.test')
        expect((await call('GET', '/admin/users', cookie)).status).toBe(403)
        expect((await call('POST', '/admin/users', cookie, NEW_USER)).status).toBe(403)
    })

    it('tạo người dùng: chuẩn hóa email, không lộ mật khẩu, trùng 409, mật khẩu yếu 400', async () => {
        await seedUser('root@az.test', { role: 'root_admin' })
        const cookie = await loginAs('root@az.test')
        const created = await call('POST', '/admin/users', cookie, NEW_USER)
        expect(created.status).toBe(201)
        const text = await created.text()
        expect(text).not.toContain('password')
        const { user } = JSON.parse(text) as UserResponse
        expect(user).toMatchObject({ email: 'moi@az.test', role: 'user', status: 'active', has_token: false })

        expect((await call('POST', '/admin/users', cookie, { ...NEW_USER, email: 'MOI@az.test' })).status).toBe(409)
        expect((await call('POST', '/admin/users', cookie, { ...NEW_USER, email: 'x@az.test', password: 'ngan' })).status).toBe(400)
        // Người vừa tạo đăng nhập được.
        expect((await loginAs('moi@az.test', NEW_USER.password)).length).toBeGreaterThan(0)
    })

    it('admin thường không tạo được admin; quản trị viên gốc thì được', async () => {
        await seedUser('root@az.test', { role: 'root_admin' })
        await seedUser('ad@az.test', { role: 'admin' })
        const admin = await loginAs('ad@az.test')
        expect((await call('POST', '/admin/users', admin, { ...NEW_USER, role: 'admin' })).status).toBe(403)
        const root = await loginAs('root@az.test')
        expect((await call('POST', '/admin/users', root, { ...NEW_USER, role: 'admin' })).status).toBe(201)
    })

    it('danh sách có has_token theo token đang hoạt động', async () => {
        await seedUser('root@az.test', { role: 'root_admin' })
        const u = await seedUser('u@az.test')
        const cookie = await loginAs('root@az.test')
        const before = await (await call('GET', '/admin/users', cookie)).json<UserListResponse>()
        expect(before.users.find((x) => x.id === u.id)?.has_token).toBe(false)
        expect((await call('POST', '/admin/gw-tokens', cookie, { owner_id: u.id })).status).toBe(201)
        const after = await (await call('GET', '/admin/users', cookie)).json<UserListResponse>()
        expect(after.users.find((x) => x.id === u.id)?.has_token).toBe(true)
    })

    it('khóa người dùng: xóa phiên, thu hồi token Gateway, không đăng nhập được; mở lại thì được', async () => {
        await seedUser('root@az.test', { role: 'root_admin' })
        const u = await seedUser('u@az.test')
        const root = await loginAs('root@az.test')
        const userCookie = await loginAs('u@az.test')
        const issued = await (await call('POST', '/admin/gw-tokens', root, { owner_id: u.id })).json<GwTokenSecretResponse>()

        const res = await call('PATCH', `/admin/users/${u.id}`, root, { status: 'suspended' })
        expect(res.status).toBe(200)
        expect((await res.json<UserResponse>()).user).toMatchObject({ status: 'suspended', has_token: false })
        expect((await call('GET', '/me', userCookie)).status).toBe(401)
        const token = await env.DB.prepare('SELECT status FROM gw_tokens WHERE id = ?').bind(issued.summary.id).first<{ status: string }>()
        expect(token?.status).toBe('revoked')
        expect((await call('POST', '/auth/login', null, { email: 'u@az.test', password: TEST_PASSWORD })).status).toBe(403)

        expect((await call('PATCH', `/admin/users/${u.id}`, root, { status: 'active' })).status).toBe(200)
        expect((await loginAs('u@az.test')).length).toBeGreaterThan(0)
    })

    it('duyệt tài khoản chờ duyệt', async () => {
        await seedUser('root@az.test', { role: 'root_admin' })
        const u = await seedUser('cho@az.test', { status: 'pending' })
        const root = await loginAs('root@az.test')
        expect((await call('PATCH', `/admin/users/${u.id}`, root, { status: 'active' })).status).toBe(200)
        expect((await loginAs('cho@az.test')).length).toBeGreaterThan(0)
    })

    it('đặt lại mật khẩu: mật khẩu cũ hết hiệu lực và phiên cũ bị đăng xuất', async () => {
        await seedUser('root@az.test', { role: 'root_admin' })
        const u = await seedUser('u@az.test')
        const root = await loginAs('root@az.test')
        const old = await loginAs('u@az.test')
        expect((await call('PATCH', `/admin/users/${u.id}`, root, { password: 'mat-khau-moi-456' })).status).toBe(200)
        expect((await call('GET', '/me', old)).status).toBe(401)
        expect((await call('POST', '/auth/login', null, { email: 'u@az.test', password: TEST_PASSWORD })).status).toBe(401)
        expect((await loginAs('u@az.test', 'mat-khau-moi-456')).length).toBeGreaterThan(0)
    })

    it('giới hạn quyền: không tự đổi trạng thái, không đụng tới admin khác hay quản trị viên gốc', async () => {
        const root = await seedUser('root@az.test', { role: 'root_admin' })
        const ad = await seedUser('ad@az.test', { role: 'admin' })
        const ad2 = await seedUser('ad2@az.test', { role: 'admin' })
        const adCookie = await loginAs('ad@az.test')
        expect((await call('PATCH', `/admin/users/${ad.id}`, adCookie, { status: 'suspended' })).status).toBe(403)
        expect((await call('PATCH', `/admin/users/${ad2.id}`, adCookie, { status: 'suspended' })).status).toBe(403)
        expect((await call('PATCH', `/admin/users/${root.id}`, adCookie, { display_name: 'x' })).status).toBe(403)
        const rootCookie = await loginAs('root@az.test')
        expect((await call('PATCH', `/admin/users/${root.id}`, rootCookie, { status: 'suspended' })).status).toBe(403)
        expect((await call('PATCH', `/admin/users/${ad2.id}`, rootCookie, { status: 'suspended' })).status).toBe(200)
    })

    it('PATCH sai dữ liệu hoặc id lạ', async () => {
        await seedUser('root@az.test', { role: 'root_admin' })
        const root = await loginAs('root@az.test')
        expect((await call('PATCH', '/admin/users/9999', root, { display_name: 'x' })).status).toBe(404)
        expect((await call('PATCH', '/admin/users/abc', root, { display_name: 'x' })).status).toBe(400)
        expect((await call('PATCH', '/admin/users/1', root, {})).status).toBe(400)
        expect((await call('PATCH', '/admin/users/1', root, { role: 'root_admin' })).status).toBe(400)
    })
})