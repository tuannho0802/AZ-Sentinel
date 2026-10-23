import { describe, expect, it } from 'vitest'
import { failoverTarget } from './failover'

const here = { origin: 'https://abc-123.trycloudflare.com', pathname: '/links/5', search: '?q=1' }

describe('failoverTarget', () => {
  it('giữ nguyên trang đang xem khi chuyển sang bản dự phòng', () => {
    expect(failoverTarget('https://az-api.acc.workers.dev/', here)).toBe(
      'https://az-api.acc.workers.dev/links/5?q=1',
    )
  })

  it('không chuyển khi đã ở chính origin dự phòng (tránh vòng lặp)', () => {
    expect(failoverTarget('https://abc-123.trycloudflare.com', here)).toBeNull()
  })

  it('bỏ qua giá trị rỗng, sai định dạng hoặc giao thức lạ', () => {
    expect(failoverTarget(null, here)).toBeNull()
    expect(failoverTarget('', here)).toBeNull()
    expect(failoverTarget('khong-phai-url', here)).toBeNull()
    expect(failoverTarget('javascript:alert(1)', here)).toBeNull()
  })
})
