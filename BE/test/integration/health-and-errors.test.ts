import { exports } from 'cloudflare:workers'
import { isApiErrorBody } from '@az-sentinel/shared'
import { describe, expect, it } from 'vitest'

const get = (path: string, init?: RequestInit) =>
  exports.default.fetch(new Request(`http://az.test${path}`, init))

describe('GET /api/health', () => {
  it('trả 200 {status:"ok"} không cần xác thực', async () => {
    const res = await get('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  it('không lộ phiên bản hay cấu hình', async () => {
    const text = await (await get('/api/health')).text()
    expect(text).not.toMatch(/version|wrangler|database|binding/i)
  })

  it('có X-Request-Id để truy vết', async () => {
    const res = await get('/api/health')
    expect(res.headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('lỗi chuẩn', () => {
  it('route không tồn tại trả 404 đúng dạng lỗi chuẩn', async () => {
    const res = await get('/api/khong-co')
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(isApiErrorBody(body)).toBe(true)
    expect(body).toMatchObject({ error: { code: 'NOT_FOUND' } })
  })

  it('sai method trên ingest không trả stack trace', async () => {
    const res = await get('/api/ea/v1/ingest')
    expect(res.status).toBe(404)
    expect(await res.text()).not.toMatch(/at \w+ \(|node_modules/)
  })
})
