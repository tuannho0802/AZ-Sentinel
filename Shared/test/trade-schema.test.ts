import { describe, expect, it } from 'vitest'
import {
  CMD_ID,
  eaVersionAtLeast,
  TRADE,
  TRADE_REASONS,
  tradeRequestSchema,
  tradeResultRequestSchema,
} from '../src/trade-schema'

describe('tradeRequestSchema', () => {
  it('nhận đúng ba loại lệnh', () => {
    expect(tradeRequestSchema.safeParse({ op: 'close', ticket: 5 }).success).toBe(true)
    expect(
      tradeRequestSchema.safeParse({ op: 'partial_close', ticket: 5, volume: 0.01 }).success,
    ).toBe(true)
    expect(
      tradeRequestSchema.safeParse({ op: 'modify', ticket: 5, sl: 0, tp: 4100.5 }).success,
    ).toBe(true)
  })

  it('từ chối op lạ (không có đường tắt kiểu buy/open)', () => {
    expect(tradeRequestSchema.safeParse({ op: 'buy', ticket: 1 }).success).toBe(false)
    expect(tradeRequestSchema.safeParse({ op: 'open', symbol: 'XAUUSD', volume: 1 }).success).toBe(
      false,
    )
  })

  it.each([
    ['ticket 0', { op: 'close', ticket: 0 }],
    ['ticket âm', { op: 'close', ticket: -1 }],
    ['ticket thập phân', { op: 'close', ticket: 1.5 }],
    ['ticket vượt số nguyên an toàn', { op: 'close', ticket: 2 ** 60 }],
    ['volume 0', { op: 'partial_close', ticket: 1, volume: 0 }],
    ['volume âm', { op: 'partial_close', ticket: 1, volume: -0.1 }],
    ['volume vượt trần', { op: 'partial_close', ticket: 1, volume: TRADE.maxVolume + 1 }],
    ['volume NaN', { op: 'partial_close', ticket: 1, volume: Number.NaN }],
    ['volume Infinity', { op: 'partial_close', ticket: 1, volume: Number.POSITIVE_INFINITY }],
    ['modify thiếu sl', { op: 'modify', ticket: 1, tp: 1 }],
    ['modify giá âm', { op: 'modify', ticket: 1, sl: -1, tp: 0 }],
    ['modify giá quá lớn', { op: 'modify', ticket: 1, sl: 1e10, tp: 0 }],
  ])('từ chối: %s', (_n, body) => {
    expect(tradeRequestSchema.safeParse(body).success).toBe(false)
  })

  it('modify cho phép 0 (bỏ SL/TP)', () => {
    expect(tradeRequestSchema.safeParse({ op: 'modify', ticket: 1, sl: 0, tp: 0 }).success).toBe(
      true,
    )
  })
})

describe('tradeResultRequestSchema', () => {
  const base = {
    v: 1,
    sid: 'S1',
    key: 'k'.repeat(20),
    login: 111,
    server: 'Demo-1',
    cmd_id: '0123456789abcdef',
    status: 'done',
    reason: 'ok',
    code: 10009,
    detail: 'Request executed',
  }

  it('nhận kết quả hợp lệ, có hoặc không có left', () => {
    expect(tradeResultRequestSchema.safeParse(base).success).toBe(true)
    expect(tradeResultRequestSchema.safeParse({ ...base, left: 0.03 }).success).toBe(true)
  })

  it('detail mặc định rỗng khi vắng', () => {
    const { detail: _d, ...noDetail } = base
    expect(tradeResultRequestSchema.parse(noDetail).detail).toBe('')
  })

  it.each([
    ['cmd_id sai độ dài', { cmd_id: 'abc' }],
    ['cmd_id chữ hoa', { cmd_id: '0123456789ABCDEF' }],
    ['status lạ', { status: 'sent' }],
    ['reason lạ', { reason: 'tuy_thich' }],
    ['detail quá dài', { detail: 'x'.repeat(121) }],
    ['left âm', { left: -1 }],
  ])('từ chối: %s', (_n, over) => {
    expect(tradeResultRequestSchema.safeParse({ ...base, ...over }).success).toBe(false)
  })

  it('mọi reason EA có thể gửi đều nằm trong danh sách', () => {
    for (const r of [
      'ok',
      'remote_disabled',
      'expired',
      'no_position',
      'bad_volume',
      'bad_stops',
      'bad_request',
      'algo_off',
      'market_closed',
      'retcode',
    ]) {
      expect(TRADE_REASONS).toContain(r)
    }
  })
})

describe('CMD_ID và hằng số an toàn', () => {
  it('CMD_ID chỉ nhận 16 ký tự hex thường', () => {
    expect(CMD_ID.test('0123456789abcdef')).toBe(true)
    expect(CMD_ID.test('0123456789abcde')).toBe(false)
    expect(CMD_ID.test('0123456789abcdeg')).toBe(false)
  })

  it('EA chỉ bắt đầu khi còn đủ hạn và hạn dài hơn mức tối thiểu', () => {
    expect(TRADE.minStartMs).toBeLessThan(TRADE.ttlMs)
    expect(TRADE.graceMs).toBeGreaterThan(0)
    expect(TRADE.busySec * 1000).toBeGreaterThan(TRADE.ttlMs + TRADE.graceMs)
  })
})

describe('eaVersionAtLeast', () => {
  it('so sánh theo số, không theo chuỗi', () => {
    expect(eaVersionAtLeast('0.5.0', '0.5.0')).toBe(true)
    expect(eaVersionAtLeast('0.10.0', '0.5.0')).toBe(true)
    expect(eaVersionAtLeast('1.0.0', '0.5.0')).toBe(true)
    expect(eaVersionAtLeast('0.4.9', '0.5.0')).toBe(false)
    expect(eaVersionAtLeast('0.5.0-beta', '0.5.0')).toBe(true)
  })

  it('phiên bản lạ hoặc vắng coi là cũ', () => {
    expect(eaVersionAtLeast(null, '0.5.0')).toBe(false)
    expect(eaVersionAtLeast(undefined, '0.5.0')).toBe(false)
    expect(eaVersionAtLeast('', '0.5.0')).toBe(false)
    expect(eaVersionAtLeast('abc', '0.5.0')).toBe(false)
  })
})
