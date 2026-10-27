import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { strings } from '../../lib/strings'
import { applyLiveMessage, clearLive, clearTradeResults } from './live/live-store'
import { TRADE_CLIENT_WAIT_MS, TradeOutcome } from './TradeControls'

const CMD = '0123456789abcdef'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  clearLive()
  clearTradeResults()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('TradeOutcome: hạn chờ phía FE', () => {
  it('chưa có kết quả thì hiện "đang chờ"; quá hạn thì báo không biết, không chờ mãi', () => {
    render(<TradeOutcome cmdId={CMD} />)
    expect(screen.getByText(strings.tradeWaiting)).toBeTruthy()
    act(() => {
      vi.advanceTimersByTime(TRADE_CLIENT_WAIT_MS - 1)
    })
    expect(screen.getByText(strings.tradeWaiting)).toBeTruthy()
    act(() => {
      vi.advanceTimersByTime(2)
    })
    expect(screen.getByText(strings.tradeTimeout)).toBeTruthy()
    expect(screen.queryByText(strings.tradeWaiting)).toBeNull()
  })

  it('kết quả thật đến muộn (sau hạn chờ) vẫn hiện và thắng thông báo "không biết"', () => {
    render(<TradeOutcome cmdId={CMD} />)
    act(() => {
      vi.advanceTimersByTime(TRADE_CLIENT_WAIT_MS + 1)
    })
    expect(screen.getByText(strings.tradeTimeout)).toBeTruthy()
    act(() => {
      applyLiveMessage({
        t: 'trade_result',
        id: 1,
        server_time: 1_760_000_000,
        cmd_id: CMD,
        status: 'done',
        reason: 'ok',
        code: 10009,
        detail: '',
      })
    })
    expect(screen.queryByText(strings.tradeTimeout)).toBeNull()
    expect(screen.getByText(new RegExp(strings.tradeDone))).toBeTruthy()
  })

  it('có kết quả trước hạn thì không bao giờ hiện thông báo không biết', () => {
    applyLiveMessage({
      t: 'trade_result',
      id: 1,
      server_time: 1_760_000_000,
      cmd_id: CMD,
      status: 'failed',
      reason: 'no_position',
      code: 0,
      detail: 'position not found',
    })
    render(<TradeOutcome cmdId={CMD} />)
    act(() => {
      vi.advanceTimersByTime(TRADE_CLIENT_WAIT_MS * 2)
    })
    expect(screen.queryByText(strings.tradeTimeout)).toBeNull()
    expect(screen.getByText(/position not found/)).toBeTruthy()
  })

  it('hạn chờ lớn hơn hạn dùng + ân hạn của Gateway (không báo trước khi Gateway kịp báo)', () => {
    expect(TRADE_CLIENT_WAIT_MS).toBeGreaterThan(15_000 + 8_000)
  })
})
