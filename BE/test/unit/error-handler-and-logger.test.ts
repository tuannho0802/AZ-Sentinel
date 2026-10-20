import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '../../src/lib/app-error'
import { notFound, onError } from '../../src/middleware/error-handler'
import { requestLogger } from '../../src/middleware/request-logger'
import type { AppEnv } from '../../src/types'

function buildApp() {
  const app = new Hono<AppEnv>()
  app.use('*', requestLogger)
  app.get('/boom', () => {
    throw new Error('SELECT * FROM users WHERE password_hash = secret-internal-detail')
  })
  app.get('/app-error', () => {
    throw new AppError(409, 'CONFLICT', 'Xung đột dữ liệu')
  })
  app.get('/http-400', () => {
    throw new HTTPException(400, { message: 'chi tiết nội bộ của thư viện' })
  })
  app.get('/ok', (c) => c.json({ ok: true }))
  app.onError(onError)
  app.notFound(notFound)
  return app
}

afterEach(() => vi.restoreAllMocks())

describe('onError', () => {
  it('lỗi không lường trước trả 500 INTERNAL, không lộ chi tiết', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const res = await buildApp().request('/boom')
    expect(res.status).toBe(500)
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ error: { code: 'INTERNAL', message: 'Lỗi hệ thống' } })
    expect(text).not.toMatch(/SELECT|password_hash|secret-internal/)
  })

  it('AppError giữ nguyên mã HTTP, code và message', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const res = await buildApp().request('/app-error')
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: { code: 'CONFLICT', message: 'Xung đột dữ liệu' } })
  })

  it('HTTPException 4xx được chuẩn hóa, không lộ message gốc', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const res = await buildApp().request('/http-400')
    expect(res.status).toBe(400)
    const text = await res.text()
    expect(text).toContain('VALIDATION_FAILED')
    expect(text).not.toContain('nội bộ của thư viện')
  })
})

describe('requestLogger', () => {
  it('ghi một dòng JSON có requestId, route, status, durationMs', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await buildApp().request('/ok')
    const line = JSON.parse(String(spy.mock.calls[0]?.[0]))
    expect(line).toMatchObject({ level: 'info', method: 'GET', route: '/ok', status: 200 })
    expect(typeof line.requestId).toBe('string')
    expect(typeof line.durationMs).toBe('number')
  })

  it('không bao giờ log API key, cookie hay query string', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await buildApp().request('/ok?token=bi-mat-query', {
      headers: { 'X-API-Key': 'KHOA-RAT-BI-MAT', Cookie: 'session=COOKIE-BI-MAT' },
    })
    const logged = spy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(logged).not.toMatch(/KHOA-RAT-BI-MAT|COOKIE-BI-MAT|bi-mat-query/)
  })

  it('lỗi 500 chỉ log tên và message đã cắt, không log header hay body', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await buildApp().request('/boom', { headers: { 'X-API-Key': 'KHOA-RAT-BI-MAT' } })
    const logged = spy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(logged).toContain('"level":"error"')
    expect(logged).not.toContain('KHOA-RAT-BI-MAT')
  })
})
