import { describe, expect, it } from 'vitest'
import {
  CLOSE_ALL_FILTERS,
  CMD_ID,
  eaVersionAtLeast,
  hasTicket,
  matchesCloseAll,
  minEaVerForOp,
  PENDING_KINDS,
  pendingStopsOk,
  SYMBOL_RE,
  TRADE,
  TRADE_REASONS,
  type TradeRequest,
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

describe('Pha 2: market', () => {
  const ok = { op: 'market', symbol: 'XAUUSD', side: 'buy', volume: 0.1, sl: 0, tp: 0 }

  it('nhận market buy/sell, SL/TP = 0 nghĩa là không đặt', () => {
    expect(tradeRequestSchema.safeParse(ok).success).toBe(true)
    expect(tradeRequestSchema.safeParse({ ...ok, side: 'sell', sl: 4100, tp: 3900 }).success).toBe(
      true,
    )
  })

  it.each([
    ['thiếu symbol', { ...ok, symbol: undefined }],
    ['symbol rỗng', { ...ok, symbol: '' }],
    ['symbol có khoảng trắng', { ...ok, symbol: 'XAU USD' }],
    ['symbol có dấu nháy', { ...ok, symbol: 'XAU"USD' }],
    ['symbol có gạch chéo', { ...ok, symbol: 'XAU/USD' }],
    ['symbol quá dài', { ...ok, symbol: 'A'.repeat(33) }],
    ['side lạ', { ...ok, side: 'long' }],
    ['thiếu side', { ...ok, side: undefined }],
    ['volume 0', { ...ok, volume: 0 }],
    ['volume âm', { ...ok, volume: -1 }],
    ['volume vượt trần', { ...ok, volume: TRADE.maxVolume + 1 }],
    ['volume NaN', { ...ok, volume: Number.NaN }],
    ['thiếu sl', { ...ok, sl: undefined }],
    ['thiếu tp', { ...ok, tp: undefined }],
    ['sl âm', { ...ok, sl: -1 }],
    ['tp quá lớn', { ...ok, tp: 1e10 }],
  ])('từ chối: %s', (_n, body) => {
    expect(tradeRequestSchema.safeParse(body).success).toBe(false)
  })
})

describe('Pha 2: pending', () => {
  const ok = {
    op: 'pending',
    symbol: 'EURUSD',
    kind: 'buy_limit',
    volume: 0.05,
    price: 1.1,
    sl: 1.09,
    tp: 1.12,
  }

  it('nhận đủ bốn loại lệnh chờ', () => {
    for (const kind of PENDING_KINDS) {
      const buy = kind.startsWith('buy')
      const body = { ...ok, kind, sl: buy ? 1.09 : 1.11, tp: buy ? 1.12 : 1.08 }
      expect(tradeRequestSchema.safeParse(body).success, kind).toBe(true)
    }
  })

  it('SL/TP bằng 0 (không đặt) luôn hợp lệ', () => {
    expect(tradeRequestSchema.safeParse({ ...ok, sl: 0, tp: 0 }).success).toBe(true)
  })

  it.each([
    ['kind lạ', { ...ok, kind: 'buy_market' }],
    ['thiếu price', { ...ok, price: undefined }],
    ['price 0', { ...ok, price: 0 }],
    ['price âm', { ...ok, price: -1 }],
    ['price NaN', { ...ok, price: Number.NaN }],
    ['volume 0', { ...ok, volume: 0 }],
    ['buy: SL cao hơn giá vào', { ...ok, sl: 1.11 }],
    ['buy: TP thấp hơn giá vào', { ...ok, tp: 1.09 }],
    ['sell: SL thấp hơn giá vào', { ...ok, kind: 'sell_stop', sl: 1.09, tp: 1.08 }],
    ['sell: TP cao hơn giá vào', { ...ok, kind: 'sell_stop', sl: 1.11, tp: 1.12 }],
    ['SL đúng bằng giá vào', { ...ok, sl: 1.1 }],
  ])('từ chối: %s', (_n, body) => {
    expect(tradeRequestSchema.safeParse(body).success).toBe(false)
  })

  it('lỗi SL/TP sai phía được gắn vào đường dẫn sl', () => {
    const r = tradeRequestSchema.safeParse({ ...ok, sl: 2 })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(['sl'])
  })
})

describe('Pha 2: close_all', () => {
  it('nhận cả năm bộ lọc', () => {
    for (const filter of CLOSE_ALL_FILTERS) {
      expect(tradeRequestSchema.safeParse({ op: 'close_all', filter }).success, filter).toBe(true)
    }
  })

  it('từ chối bộ lọc lạ hoặc thiếu (không có mặc định ngầm)', () => {
    expect(tradeRequestSchema.safeParse({ op: 'close_all' }).success).toBe(false)
    expect(tradeRequestSchema.safeParse({ op: 'close_all', filter: 'winners' }).success).toBe(false)
    expect(tradeRequestSchema.safeParse({ op: 'close_all', filter: '' }).success).toBe(false)
  })
})

describe('pendingStopsOk', () => {
  it('buy: SL < giá < TP', () => {
    expect(pendingStopsOk('buy_limit', 100, 99, 101)).toBe(true)
    expect(pendingStopsOk('buy_stop', 100, 101, 102)).toBe(false)
    expect(pendingStopsOk('buy_stop', 100, 99, 99.5)).toBe(false)
  })
  it('sell: TP < giá < SL', () => {
    expect(pendingStopsOk('sell_limit', 100, 101, 99)).toBe(true)
    expect(pendingStopsOk('sell_stop', 100, 99, 98)).toBe(false)
    expect(pendingStopsOk('sell_stop', 100, 101, 101.5)).toBe(false)
  })
  it('0 là bỏ, từng phía độc lập', () => {
    expect(pendingStopsOk('buy_limit', 100, 0, 101)).toBe(true)
    expect(pendingStopsOk('buy_limit', 100, 99, 0)).toBe(true)
    expect(pendingStopsOk('sell_limit', 100, 0, 0)).toBe(true)
  })
})

describe('matchesCloseAll', () => {
  const pos = (type: string, profit: number, swap = 0) => ({ type, profit, swap })

  it('all khớp mọi lệnh', () => {
    expect(matchesCloseAll('all', pos('buy', -5))).toBe(true)
    expect(matchesCloseAll('all', pos('sell', 0))).toBe(true)
  })
  it('lãi/lỗ tính cả swap', () => {
    expect(matchesCloseAll('profit', pos('buy', 1, -2))).toBe(false)
    expect(matchesCloseAll('loss', pos('buy', 1, -2))).toBe(true)
    expect(matchesCloseAll('profit', pos('buy', -1, 3))).toBe(true)
  })
  it('đúng 0 không thuộc lãi cũng không thuộc lỗ', () => {
    expect(matchesCloseAll('profit', pos('buy', 0))).toBe(false)
    expect(matchesCloseAll('loss', pos('buy', 0))).toBe(false)
    expect(matchesCloseAll('profit', pos('buy', 2, -2))).toBe(false)
  })
  it('thiếu profit/swap coi là 0', () => {
    expect(matchesCloseAll('profit', { type: 'buy' })).toBe(false)
    expect(matchesCloseAll('all', { type: 'buy' })).toBe(true)
  })
  it('buy/sell lọc theo hướng, không theo lãi lỗ', () => {
    expect(matchesCloseAll('buy', pos('buy', -9))).toBe(true)
    expect(matchesCloseAll('buy', pos('sell', 9))).toBe(false)
    expect(matchesCloseAll('sell', pos('sell', -9))).toBe(true)
    expect(matchesCloseAll('sell', pos('buy', 9))).toBe(false)
  })
})

describe('minEaVerForOp, hasTicket, SYMBOL_RE', () => {
  it('lệnh cũ cần 0.5.0, lệnh mới cần 0.6.0', () => {
    for (const op of ['close', 'partial_close', 'modify'] as const) {
      expect(minEaVerForOp(op)).toBe(TRADE.minEaVer)
    }
    for (const op of ['market', 'pending', 'close_all'] as const) {
      expect(minEaVerForOp(op)).toBe(TRADE.minEaVerOpen)
    }
    expect(eaVersionAtLeast('0.5.0', TRADE.minEaVerOpen)).toBe(false)
    expect(eaVersionAtLeast('0.6.0', TRADE.minEaVerOpen)).toBe(true)
  })

  it('hasTicket chỉ đúng với close, partial_close, modify', () => {
    const reqs: TradeRequest[] = [
      { op: 'close', ticket: 1 },
      { op: 'market', symbol: 'X', side: 'buy', volume: 1, sl: 0, tp: 0 },
      { op: 'close_all', filter: 'all' },
    ]
    expect(reqs.map(hasTicket)).toEqual([true, false, false])
  })

  it('SYMBOL_RE nhận ký hiệu sàn thường gặp, cấm ký tự phá JSON', () => {
    for (const ok of ['XAUUSD', 'EURUSD.m', 'US30#', 'BTC-USD', 'GOLD@', 'A+B', 'x_y']) {
      expect(SYMBOL_RE.test(ok), ok).toBe(true)
    }
    for (const bad of ['', 'a b', 'a"b', "a'b", 'a/b', 'a\\b', 'a\nb', 'é']) {
      expect(SYMBOL_RE.test(bad), JSON.stringify(bad)).toBe(false)
    }
  })
})

describe('kết quả Pha 2: order, n_ok, n_fail', () => {
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
    detail: '',
  }
  it('nhận order (market, pending) và n_ok/n_fail (close_all)', () => {
    expect(tradeResultRequestSchema.safeParse({ ...base, order: 555 }).success).toBe(true)
    expect(tradeResultRequestSchema.safeParse({ ...base, n_ok: 3, n_fail: 1 }).success).toBe(true)
  })
  it('từ chối order 0/âm, n_ok âm hoặc thập phân', () => {
    expect(tradeResultRequestSchema.safeParse({ ...base, order: 0 }).success).toBe(false)
    expect(tradeResultRequestSchema.safeParse({ ...base, order: -1 }).success).toBe(false)
    expect(tradeResultRequestSchema.safeParse({ ...base, n_ok: -1 }).success).toBe(false)
    expect(tradeResultRequestSchema.safeParse({ ...base, n_fail: 1.5 }).success).toBe(false)
  })
  it('lý do no_match và partial (close_all) có trong danh sách', () => {
    expect(TRADE_REASONS).toContain('no_match')
    expect(TRADE_REASONS).toContain('partial')
    expect(TRADE_REASONS).toContain('bad_price')
    expect(TRADE_REASONS).toContain('bad_symbol')
    expect(TRADE_REASONS).toContain('no_money')
  })
})
