import { describe, expect, it } from 'vitest'
import { describeUa, friendlyModel, parseUa, withOwner } from './device-name'

const S23_FULL =
  'Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
const S23_REDUCED =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
const WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

describe('friendlyModel', () => {
  it('đổi mã Samsung sang tên thương mại, bỏ qua ký tự vùng bán', () => {
    expect(friendlyModel('SM-S918B')).toBe('Galaxy S23 Ultra')
    expect(friendlyModel('SM-S918U1')).toBe('Galaxy S23 Ultra')
  })
  it('mã lạ giữ nguyên; mã rút gọn của Chrome trả rỗng', () => {
    expect(friendlyModel('Pixel 8 Pro')).toBe('Pixel 8 Pro')
    expect(friendlyModel('K')).toBe('')
    expect(friendlyModel('')).toBe('')
  })
})

describe('describeUa', () => {
  it('Android còn lộ model: tên máy + trình duyệt + hệ điều hành', () => {
    expect(describeUa(S23_FULL)).toBe('Galaxy S23 Ultra · Chrome · Android 14')
  })
  it('UA rút gọn không có model: chỉ trình duyệt + hệ điều hành', () => {
    expect(describeUa(S23_REDUCED)).toBe('Chrome · Android 10')
  })
  it('máy tính và iPhone', () => {
    expect(describeUa(WIN)).toBe('Chrome · Windows')
    expect(parseUa(IPHONE)).toEqual({ browser: 'Safari', os: 'iOS 17', model: 'iPhone' })
  })
  it('chuỗi lạ: cắt ngắn thay vì để trống', () => {
    expect(describeUa('curl/8.0')).toBe('curl/8.0')
  })
})

describe('withOwner', () => {
  it('gắn tên người dùng và giới hạn 64 ký tự', () => {
    expect(withOwner('Galaxy S23 Ultra', 'Tuấn')).toBe('Galaxy S23 Ultra của Tuấn')
    expect(withOwner('Chrome · Windows', undefined)).toBe('Chrome · Windows')
    expect(withOwner('x'.repeat(80), 'Tuấn').length).toBe(64)
  })
})
