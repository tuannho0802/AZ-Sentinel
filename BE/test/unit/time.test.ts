import { describe, expect, it } from 'vitest'
import { barTimestamp, M5_SECONDS } from '../../src/lib/time'

const NOW = 1_792_500_123

describe('barTimestamp', () => {
  it('làm tròn xuống đầu nến M5 theo ts_utc của EA khi hợp lý', () => {
    expect(barTimestamp(NOW - 3600 + 17, NOW)).toBe(Math.floor((NOW - 3600 + 17) / 300) * 300)
  })
  it('ts_utc quá cũ (hơn 7 ngày) thì dùng giờ server', () => {
    expect(barTimestamp(NOW - 8 * 86400, NOW)).toBe(Math.floor(NOW / M5_SECONDS) * M5_SECONDS)
  })
  it('ts_utc ở tương lai xa thì dùng giờ server', () => {
    expect(barTimestamp(NOW + 86400, NOW)).toBe(Math.floor(NOW / M5_SECONDS) * M5_SECONDS)
  })
  it('luôn là bội của 300', () => {
    expect(barTimestamp(NOW, NOW) % 300).toBe(0)
  })
})
