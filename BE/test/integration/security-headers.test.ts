import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/app'

const app = createApp()
const bindings = { DB: env.DB, LIVE_HUB: env.LIVE_HUB }

describe('header bảo mật', () => {
  it('API: CSP none, DENY, nosniff; HSTS chỉ khi HTTPS', async () => {
    const http = await app.fetch(new Request('http://az.test/api/health'), bindings)
    expect(http.headers.get('Content-Security-Policy')).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    )
    expect(http.headers.get('X-Frame-Options')).toBe('DENY')
    expect(http.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(http.headers.has('Strict-Transport-Security')).toBe(false)

    const https = await app.fetch(new Request('https://az.test/api/health'), bindings)
    expect(https.headers.get('Strict-Transport-Security')).toContain('max-age=')
  })

  it('lỗi 404 và lỗi xác thực cũng mang header', async () => {
    const res = await app.fetch(new Request('http://az.test/api/khong-co'), bindings)
    expect(res.status).toBe(404)
    expect(res.headers.get('X-Frame-Options')).toBe('DENY')
    const me = await app.fetch(new Request('http://az.test/api/me'), bindings)
    expect(me.status).toBe(401)
    expect(me.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'")
  })
})
