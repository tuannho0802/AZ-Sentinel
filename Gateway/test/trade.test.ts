import { TRADE, type TradeResultRequest } from '@az-sentinel/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import { Gateway } from '../src/gateway'
import { bound, fakeCloud, KEY, ping } from './helpers'

let clock = 1_000_000
const now = () => clock
const TID = '111@Demo-1'
const CMD = 'a1b2c3d4e5f60718'

function make() {
  const gw = new Gateway({ now, idleFlushSec: 0 })
  const cloud = fakeCloud()
  gw.onCloudOpen(cloud.send)
  gw.handlePing(ping())
  gw.onCloudMessage(bound(TID))
  cloud.clear()
  return { gw, cloud }
}

const closeCmd = (over: Record<string, unknown> = {}) =>
  ({ t: 'trade', tid: TID, cmd_id: CMD, op: 'close', ticket: 777, ...over }) as const

const result = (over: Partial<TradeResultRequest> = {}): TradeResultRequest => ({
  v: 1,
  sid: 'S1',
  key: KEY,
  login: 111,
  server: 'Demo-1',
  cmd_id: CMD,
  status: 'done',
  reason: 'ok',
  code: 10009,
  detail: 'done',
  ...over,
})

beforeEach(() => {
  clock = 1_000_000
})

describe('lệnh giao dịch thủ công: nhận và chuyển cho EA', () => {
  it('không có lệnh thì phản hồi không có trường tr_*', () => {
    const { gw } = make()
    const r = gw.handlePing(ping())
    expect(Object.keys(r).some((k) => k.startsWith('tr_'))).toBe(false)
  })

  it('lệnh close được đưa vào phản hồi ping với ttl còn lại', () => {
    const { gw } = make()
    gw.onCloudMessage(closeCmd())
    clock += 1000
    const r = gw.handlePing(ping())
    expect(r.tr_id).toBe(CMD)
    expect(r.tr_op).toBe('close')
    expect(r.tr_ticket).toBe(777)
    expect(r.tr_ttl).toBe(TRADE.ttlMs - 1000)
    expect(r.tr_vol).toBeUndefined()
  })

  it('partial_close mang tr_vol, modify mang tr_sl và tr_tp (0 = bỏ)', () => {
    const a = make()
    a.gw.onCloudMessage(closeCmd({ op: 'partial_close', volume: 0.02 }))
    expect(a.gw.handlePing(ping()).tr_vol).toBe(0.02)

    const b = make()
    b.gw.onCloudMessage(closeCmd({ op: 'modify', sl: 0, tp: 4100.5 }))
    const r = b.gw.handlePing(ping())
    expect(r.tr_sl).toBe(0)
    expect(r.tr_tp).toBe(4100.5)
  })

  it('lệnh vẫn được gửi lại ở mỗi phản hồi cho tới khi có kết quả (EA tự loại trùng)', () => {
    const { gw } = make()
    gw.onCloudMessage(closeCmd())
    expect(gw.handlePing(ping()).tr_id).toBe(CMD)
    expect(gw.handlePing(ping()).tr_id).toBe(CMD)
  })

  it('quá hạn thì không còn đưa cho EA, và chỉ báo timeout sau thời gian ân hạn', () => {
    const { gw, cloud } = make()
    gw.onCloudMessage(closeCmd())
    clock += TRADE.ttlMs + 1
    expect(gw.handlePing(ping()).tr_id).toBeUndefined()
    gw.sweep()
    expect(cloud.of('trade_result')).toHaveLength(0)
    clock += TRADE.graceMs
    gw.sweep()
    const r = cloud.of('trade_result')
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ cmd_id: CMD, status: 'timeout', reason: 'no_reply' })
  })
})

describe('lệnh giao dịch thủ công: từ chối ngay', () => {
  it('terminal lạ', () => {
    const { gw, cloud } = make()
    gw.onCloudMessage(closeCmd({ tid: '999@Demo-1' }))
    expect(cloud.of('trade_result')[0]).toMatchObject({
      status: 'failed',
      reason: 'terminal_offline',
    })
  })

  it('terminal offline (EA im quá lâu)', () => {
    const { gw, cloud } = make()
    clock += 30_000
    gw.sweep()
    cloud.clear()
    gw.onCloudMessage(closeCmd())
    expect(cloud.of('trade_result')[0]).toMatchObject({ reason: 'terminal_offline' })
  })

  it('đang có lệnh khác thì báo busy và KHÔNG thay lệnh đang chờ', () => {
    const { gw, cloud } = make()
    gw.onCloudMessage(closeCmd())
    gw.onCloudMessage(closeCmd({ cmd_id: 'ffffffffffffffff', ticket: 888 }))
    expect(cloud.of('trade_result')[0]).toMatchObject({
      cmd_id: 'ffffffffffffffff',
      reason: 'busy',
    })
    expect(gw.handlePing(ping()).tr_ticket).toBe(777)
  })

  it('thiếu trường (partial_close không có volume, modify thiếu sl/tp) bị từ chối', () => {
    const { gw, cloud } = make()
    gw.onCloudMessage(closeCmd({ op: 'partial_close' }))
    gw.onCloudMessage(closeCmd({ op: 'modify', sl: 1 }))
    const r = cloud.of('trade_result')
    expect(r).toHaveLength(2)
    expect(r.every((x) => x.reason === 'bad_request')).toBe(true)
    expect(gw.handlePing(ping()).tr_id).toBeUndefined()
  })
})

describe('kết quả từ EA', () => {
  it('chuyển lên cloud và xóa lệnh đang chờ', () => {
    const { gw, cloud } = make()
    gw.onCloudMessage(closeCmd())
    expect(gw.handleTradeResult(result())).toEqual({ ok: true })
    expect(cloud.of('trade_result')[0]).toMatchObject({ cmd_id: CMD, status: 'done', code: 10009 })
    expect(gw.handlePing(ping()).tr_id).toBeUndefined()
  })

  it('terminal lạ hoặc sai khóa trả null', () => {
    const { gw } = make()
    expect(gw.handleTradeResult(result({ login: 999 }))).toBeNull()
    expect(gw.handleTradeResult(result({ key: 'sai-khoa' }))).toBeNull()
  })

  it('kết quả muộn (sau timeout) vẫn được chuyển tiếp', () => {
    const { gw, cloud } = make()
    gw.onCloudMessage(closeCmd())
    clock += TRADE.ttlMs + TRADE.graceMs + 1
    gw.sweep()
    gw.handleTradeResult(result())
    expect(cloud.of('trade_result').map((r) => r.status)).toEqual(['timeout', 'done'])
  })

  it('mất cloud lúc báo: giữ kết quả, gửi lại sau khi bind lại', () => {
    const { gw, cloud } = make()
    gw.onCloudMessage(closeCmd())
    gw.onCloudClose()
    gw.handleTradeResult(result())
    expect(cloud.of('trade_result')).toHaveLength(0)
    gw.onCloudOpen(cloud.send)
    gw.onCloudMessage(bound(TID))
    expect(cloud.of('trade_result')).toHaveLength(1)
  })
})

describe('an toàn khi mất cloud', () => {
  it('lệnh chưa tới EA bị hủy khi cloud ngắt', () => {
    const { gw, cloud } = make()
    gw.onCloudMessage(closeCmd())
    gw.onCloudClose()
    gw.onCloudOpen(cloud.send)
    gw.onCloudMessage(bound(TID))
    expect(gw.handlePing(ping()).tr_id).toBeUndefined()
  })

  it('bind bị từ chối thì bỏ lệnh và kết quả đang giữ', () => {
    const { gw } = make()
    gw.onCloudMessage(closeCmd())
    gw.onCloudMessage({ t: 'reject', tid: TID, code: 403 })
    expect(gw.handlePing(ping()).tr_id).toBeUndefined()
  })
})

const marketCmd = (over: Record<string, unknown> = {}) =>
  ({
    t: 'trade',
    tid: TID,
    cmd_id: CMD,
    op: 'market',
    symbol: 'XAUUSD',
    side: 'buy',
    volume: 0.1,
    sl: 0,
    tp: 4100,
    ...over,
  }) as const

const pendingCmd = (over: Record<string, unknown> = {}) =>
  ({
    t: 'trade',
    tid: TID,
    cmd_id: CMD,
    op: 'pending',
    symbol: 'XAUUSD',
    kind: 'buy_limit',
    volume: 0.1,
    price: 3990,
    sl: 3980,
    tp: 4010,
    ...over,
  }) as const

describe('Pha 2: market, pending, close_all chuyển cho EA', () => {
  it('market: tr_sym, tr_side, tr_vol, tr_sl, tr_tp; KHÔNG có tr_ticket', () => {
    const { gw } = make()
    gw.onCloudMessage(marketCmd())
    const r = gw.handlePing(ping())
    expect(r).toMatchObject({
      tr_id: CMD,
      tr_op: 'market',
      tr_sym: 'XAUUSD',
      tr_side: 'buy',
      tr_vol: 0.1,
      tr_sl: 0,
      tr_tp: 4100,
    })
    expect(r.tr_ticket).toBeUndefined()
    expect(r.tr_kind).toBeUndefined()
    expect(r.tr_px).toBeUndefined()
  })

  it('pending: thêm tr_kind và tr_px', () => {
    const { gw } = make()
    gw.onCloudMessage(pendingCmd())
    const r = gw.handlePing(ping())
    expect(r).toMatchObject({
      tr_op: 'pending',
      tr_sym: 'XAUUSD',
      tr_kind: 'buy_limit',
      tr_px: 3990,
      tr_vol: 0.1,
      tr_sl: 3980,
      tr_tp: 4010,
    })
    expect(r.tr_side).toBeUndefined()
    expect(r.tr_ticket).toBeUndefined()
  })

  it('close_all: chỉ mang tr_filter', () => {
    const { gw } = make()
    gw.onCloudMessage({ t: 'trade', tid: TID, cmd_id: CMD, op: 'close_all', filter: 'loss' })
    const r = gw.handlePing(ping())
    expect(r.tr_op).toBe('close_all')
    expect(r.tr_filter).toBe('loss')
    for (const k of ['tr_ticket', 'tr_vol', 'tr_sl', 'tr_tp', 'tr_sym', 'tr_px']) {
      expect(r, k).not.toHaveProperty(k)
    }
  })

  it('lệnh mới cũng có ttl còn lại và được gửi lại tới khi có kết quả', () => {
    const { gw } = make()
    gw.onCloudMessage(marketCmd())
    clock += 2000
    expect(gw.handlePing(ping()).tr_ttl).toBe(TRADE.ttlMs - 2000)
    expect(gw.handlePing(ping()).tr_id).toBe(CMD)
  })
})

describe('Pha 2: thiếu trường thì từ chối ngay', () => {
  it.each([
    ['market thiếu symbol', marketCmd({ symbol: undefined })],
    ['market thiếu side', marketCmd({ side: undefined })],
    ['market thiếu volume', marketCmd({ volume: undefined })],
    ['market thiếu sl', marketCmd({ sl: undefined })],
    ['market thiếu tp', marketCmd({ tp: undefined })],
    ['pending thiếu kind', pendingCmd({ kind: undefined })],
    ['pending thiếu price', pendingCmd({ price: undefined })],
    ['pending thiếu symbol', pendingCmd({ symbol: undefined })],
    ['close_all thiếu filter', { t: 'trade', tid: TID, cmd_id: CMD, op: 'close_all' }],
    ['close thiếu ticket', { t: 'trade', tid: TID, cmd_id: CMD, op: 'close' }],
    ['modify thiếu ticket', closeCmd({ op: 'modify', ticket: undefined, sl: 1, tp: 1 })],
  ])('%s -> bad_request, không giữ lệnh', (_n, msg) => {
    const { gw, cloud } = make()
    gw.onCloudMessage(msg as never)
    const r = cloud.of('trade_result')
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ status: 'failed', reason: 'bad_request' })
    expect(gw.handlePing(ping()).tr_id).toBeUndefined()
  })

  it('lệnh mới khi terminal đang có lệnh khác: busy và giữ nguyên lệnh đang chờ', () => {
    const { gw, cloud } = make()
    gw.onCloudMessage(closeCmd())
    gw.onCloudMessage(marketCmd({ cmd_id: 'ffffffffffffffff' }))
    expect(cloud.of('trade_result')[0]).toMatchObject({ reason: 'busy' })
    expect(gw.handlePing(ping()).tr_id).toBe(CMD)
  })
})

describe('Pha 2: kết quả mang order, n_ok, n_fail', () => {
  it('order của market được chuyển lên cloud', () => {
    const { gw, cloud } = make()
    gw.onCloudMessage(marketCmd())
    gw.handleTradeResult(result({ order: 987654 }))
    expect(cloud.of('trade_result')[0]).toMatchObject({
      cmd_id: CMD,
      status: 'done',
      order: 987654,
    })
  })

  it('close_all: n_ok và n_fail đi nguyên, kể cả khi thất bại một phần', () => {
    const { gw, cloud } = make()
    gw.onCloudMessage({ t: 'trade', tid: TID, cmd_id: CMD, op: 'close_all', filter: 'all' })
    gw.handleTradeResult(
      result({ status: 'failed', reason: 'partial', code: 10018, n_ok: 4, n_fail: 2 }),
    )
    expect(cloud.of('trade_result')[0]).toMatchObject({
      status: 'failed',
      reason: 'partial',
      n_ok: 4,
      n_fail: 2,
    })
    expect(gw.handlePing(ping()).tr_id).toBeUndefined()
  })

  it('kết quả không có order/n_ok thì cloud không nhận các trường đó', () => {
    const { gw, cloud } = make()
    gw.onCloudMessage(closeCmd())
    gw.handleTradeResult(result())
    const r = cloud.of('trade_result')[0] as Record<string, unknown>
    expect(r).not.toHaveProperty('order')
    expect(r).not.toHaveProperty('n_ok')
    expect(r).not.toHaveProperty('n_fail')
  })
})
