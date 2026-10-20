import { isApiErrorBody, MAX_INGEST_BODY_BYTES } from '@az-sentinel/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import { count, makePayload, post, resetDb, seedLink } from '../helpers'

beforeEach(resetDb)

describe('POST /api/ea/v1/ingest: đầu vào', () => {
  it('thiếu X-API-Key trả 401 INVALID_API_KEY', async () => {
    const res = await post(null, makePayload())
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_API_KEY' } })
  })

  it('key sai trả 401 và không tạo dữ liệu', async () => {
    await seedLink()
    const res = await post('khong-phai-key-that', makePayload())
    expect(res.status).toBe(401)
    expect(await count('link_state')).toBe(0)
  })

  it('key rất dài bị từ chối 401, không đem đi băm', async () => {
    const res = await post('k'.repeat(500), makePayload())
    expect(res.status).toBe(401)
  })

  it('JSON hỏng trả 400 VALIDATION_FAILED', async () => {
    const { key } = await seedLink()
    const res = await post(key, '{"v":1,')
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(isApiErrorBody(body)).toBe(true)
    expect(body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } })
  })

  it('sai schema trả 400, message nêu tên trường nhưng không lộ nội bộ', async () => {
    const { key } = await seedLink()
    const bad = makePayload()
    const res = await post(key, { ...bad, account: { ...bad.account, equity: 'abc' } })
    expect(res.status).toBe(400)
    const text = await res.text()
    expect(text).toContain('account.equity')
    expect(text).not.toMatch(/ZodError|stack|node_modules/)
    expect(await count('link_state')).toBe(0)
  })

  it('từ chối phiên bản schema lạ (v=2)', async () => {
    const { key } = await seedLink()
    const res = await post(key, { ...makePayload(), v: 2 })
    expect(res.status).toBe(400)
  })

  it('body quá 64 KB trả 413 trước khi xử lý', async () => {
    const { key } = await seedLink()
    const big = { ...makePayload(), pad: 'x'.repeat(MAX_INGEST_BODY_BYTES + 10) }
    const res = await post(key, big)
    expect(res.status).toBe(413)
    expect(await res.json()).toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } })
    expect(await count('link_state')).toBe(0)
  })

  it('body quá lớn nhưng không có Content-Length vẫn bị chặn (413)', async () => {
    const { key } = await seedLink()
    const body = JSON.stringify({ ...makePayload(), pad: 'x'.repeat(MAX_INGEST_BODY_BYTES + 10) })
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body))
        controller.close()
      },
    })
    const { exports } = await import('cloudflare:workers')
    const res = await exports.default.fetch(
      new Request('http://az.test/api/ea/v1/ingest', {
        method: 'POST',
        headers: { 'X-API-Key': key, 'Content-Type': 'application/json' },
        body: stream,
        // @ts-expect-error duplex bắt buộc khi gửi ReadableStream, chưa có trong kiểu RequestInit
        duplex: 'half',
      }),
    )
    expect(res.status).toBe(413)
  })

  it('không bao giờ phản hồi lại API key trong thân lỗi', async () => {
    const { key } = await seedLink({ status: 'disabled' })
    const res = await post(key, makePayload())
    expect(await res.text()).not.toContain(key)
  })
})
