import type { LinkSummary, ServerMessage } from '@az-sentinel/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyLiveMessage,
  clearLive,
  clearTradeResults,
  getTradeResult,
  mergeLive,
  subscribeTrade,
} from './live-store'

type TradeResult = Extract<ServerMessage, { t: 'trade_result' }>

const result = (over: Partial<TradeResult> = {}): TradeResult => ({
  t: 'trade_result',
  id: 1,
  server_time: 1_760_000_000,
  cmd_id: '0123456789abcdef',
  status: 'done',
  reason: 'ok',
  code: 10009,
  detail: 'Request executed',
  ...over,
})

const cmd = (n: number) => n.toString(16).padStart(16, '0')

beforeEach(() => {
  clearLive()
  clearTradeResults()
})

describe('kết quả giao dịch trong live-store', () => {
  it('lưu theo cmd_id và báo cho người đăng ký', () => {
    const listener = vi.fn()
    const off = subscribeTrade(listener)
    applyLiveMessage(result())
    expect(getTradeResult('0123456789abcdef')).toMatchObject({ status: 'done', code: 10009 })
    expect(listener).toHaveBeenCalledTimes(1)
    off()
    applyLiveMessage(result({ cmd_id: cmd(2) }))
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('cmd_id rỗng hoặc chưa có kết quả thì không có gì', () => {
    expect(getTradeResult(null)).toBeUndefined()
    expect(getTradeResult(cmd(99))).toBeUndefined()
  })

  it('kết quả muộn của EA ghi đè timeout (thông tin thật thắng "không biết")', () => {
    applyLiveMessage(result({ status: 'timeout', reason: 'no_reply', code: 0, detail: '' }))
    expect(getTradeResult('0123456789abcdef')?.status).toBe('timeout')
    applyLiveMessage(result())
    expect(getTradeResult('0123456789abcdef')?.status).toBe('done')
  })

  it('chỉ giữ 20 kết quả mới nhất', () => {
    for (let i = 1; i <= 25; i++) applyLiveMessage(result({ cmd_id: cmd(i) }))
    expect(getTradeResult(cmd(1))).toBeUndefined()
    expect(getTradeResult(cmd(5))).toBeUndefined()
    expect(getTradeResult(cmd(6))).toBeDefined()
    expect(getTradeResult(cmd(25))).toBeDefined()
  })

  it('nối lại (snapshot mới) không làm mất kết quả đang chờ hiển thị', () => {
    applyLiveMessage(result())
    applyLiveMessage({ t: 'snapshot', server_time: 1_760_000_001, links: [] })
    expect(getTradeResult('0123456789abcdef')).toBeDefined()
  })
})

describe('mergeLive: margin theo mẫu (EA >= 0.5.0)', () => {
  const link = {
    id: 1,
    state: {
      balance: 1000,
      equity: 1010,
      margin: 50,
      margin_free: 960,
      margin_level: null,
      floating_pl: 10,
      last_reason: null,
      last_seen_at: 1,
      last_seq: 1,
      ea_ver: '0.5.0',
      vps_label: null,
      positions_count: 0,
      online: true,
    },
  } as unknown as LinkSummary
  const entry = (mg?: number) =>
    ({
      state: 'live',
      sample: { t: 2, eq: 1100, bal: 1000, fl: 100, ml: null, ...(mg === undefined ? {} : { mg }) },
      positionsCount: 0,
      positions: null,
      pl: null,
      posVersion: 0,
      sampleAtPerf: 0,
    }) as unknown as Parameters<typeof mergeLive>[1]

  it('mẫu có mg thì margin lấy theo mẫu', () => {
    expect(mergeLive(link, entry(75.5)).state?.margin).toBe(75.5)
  })

  it('EA cũ không có mg thì giữ margin đã lưu', () => {
    expect(mergeLive(link, entry()).state?.margin).toBe(50)
  })

  it('mg = 0 (đã đóng hết lệnh) vẫn thắng số cũ', () => {
    expect(mergeLive(link, entry(0)).state?.margin).toBe(0)
  })
})
