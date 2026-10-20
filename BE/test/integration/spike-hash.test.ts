import { exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

const get = (path: string) => exports.default.fetch(new Request(`http://az.test${path}`))

describe('GET /api/_spike/hash (spike, xóa ở P1-31)', () => {
  it('trả iter và thời gian khi iter hợp lệ', async () => {
    const res = await get('/api/_spike/hash?iter=1000')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { iter: number; wallMs: number }
    expect(body.iter).toBe(1000)
    expect(body.wallMs).toBeGreaterThanOrEqual(0)
  })

  it.each(['0', '100001', 'abc', ''])('từ chối iter=%s với 400', async (iter) => {
    const res = await get(`/api/_spike/hash?iter=${iter}`)
    expect(res.status).toBe(400)
  })
})
