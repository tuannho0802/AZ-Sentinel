import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { startHttpServer } from '../src/http'

describe('Server HTTP: header bảo mật', () => {
  const servers: ReturnType<typeof startHttpServer>[] = []
  afterEach(() => {
    for (const s of servers.splice(0)) s.close()
  })

  async function boot() {
    const server = startHttpServer({
      port: 0,
      host: '127.0.0.1',
      handler: (req) =>
        new URL(req.url).pathname.startsWith('/api/')
          ? Response.json({ ok: true })
          : new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } }),
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.on('listening', () => resolve()))
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  }

  it('trang giao diện: CSP, không cho nhúng iframe, nosniff', async () => {
    const res = await fetch(`${await boot()}/`)
    expect(res.headers.get('Content-Security-Policy')).toContain("script-src 'self'")
    expect(res.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'")
    expect(res.headers.get('X-Frame-Options')).toBe('DENY')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.has('Strict-Transport-Security')).toBe(false)
  })

  it('API: CSP none; HSTS khi đi qua tunnel HTTPS (X-Forwarded-Proto)', async () => {
    const url = await boot()
    const res = await fetch(`${url}/api/x`, { headers: { 'x-forwarded-proto': 'https' } })
    expect(res.headers.get('Content-Security-Policy')).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    )
    expect(res.headers.get('Strict-Transport-Security')).toContain('max-age=')
  })
})
