import { describe, expect, it } from 'vitest'
import { dropStayParam, failoverTarget, stayOnFallback } from './failover'

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

describe('stayOnFallback / dropStayParam', () => {
  it('thêm tham số ở lại, giữ đường dẫn và query', () => {
    expect(stayOnFallback('https://az.workers.dev/links/3?tab=live')).toBe(
      'https://az.workers.dev/links/3?tab=live&az_stay=1',
    )
  })

  it('bỏ tham số khỏi thanh địa chỉ, giữ phần còn lại', () => {
    const calls: string[] = []
    const hist = {
      state: null,
      replaceState: (_s: unknown, _t: string, u: string) => calls.push(u),
    }
    dropStayParam(
      { href: 'https://az.workers.dev/links?tab=live&az_stay=1#x' } as Location,
      hist as unknown as History,
    )
    expect(calls).toEqual(['/links?tab=live#x'])
  })

  it('gỡ cả vé trao mã thiết bị az_dh (Server phục vụ trang ngay, không còn 302 sang URL sạch)', () => {
    const calls: string[] = []
    const hist = {
      state: null,
      replaceState: (_s: unknown, _t: string, u: string) => calls.push(u),
    }
    dropStayParam(
      { href: 'https://abc.trycloudflare.com/links?tab=live&az_dh=TICKET&az_stay=1#x' } as Location,
      hist as unknown as History,
    )
    expect(calls).toEqual(['/links?tab=live#x'])
  })

  it('không có tham số thì không đụng lịch sử', () => {
    const calls: string[] = []
    const hist = {
      state: null,
      replaceState: (_s: unknown, _t: string, u: string) => calls.push(u),
    }
    dropStayParam({ href: 'https://az.workers.dev/links' } as Location, hist as unknown as History)
    expect(calls).toEqual([])
  })
})
