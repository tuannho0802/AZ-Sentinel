import type { LinkStateView, Position } from '@az-sentinel/shared'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { strings } from '../../lib/strings'
import { PositionsFooter, summarizeAccount } from './PositionsFooter'

afterEach(cleanup)

const state: LinkStateView = {
  balance: 58236.04,
  equity: 58210.91,
  margin: 20.06,
  margin_free: 58000,
  margin_level: 290184,
  floating_pl: -25.13,
  last_reason: null,
  last_seen_at: 1,
  last_seq: 1,
  ea_ver: null,
  vps_label: null,
  positions_count: 3,
  online: true,
}

const pos = (ticket: number, swap?: number): Position => ({
  ticket,
  symbol: 'XAUUSD.s',
  type: 'buy',
  volume: 0.01,
  time: 1,
  price: 4000,
  ...(swap === undefined ? {} : { swap }),
})

describe('summarizeAccount', () => {
  it('đang live: Free margin = Equity − Margin (như MT5), không dùng số D1 đã cũ', () => {
    expect(summarizeAccount(state, [], true).freeMargin).toBe(58190.85)
  })

  it('không live: giữ nguyên Free margin đã lưu', () => {
    expect(summarizeAccount(state, [], false).freeMargin).toBe(58000)
  })

  it('thiếu Margin thì không tự suy, dùng số đã lưu', () => {
    expect(summarizeAccount({ ...state, margin: null }, [], true).freeMargin).toBe(58000)
  })

  it('Swap là tổng swap các lệnh, lệnh thiếu swap tính 0, không dính lỗi số thực', () => {
    expect(summarizeAccount(state, [pos(1, -0.1), pos(2, -0.2), pos(3)], false).swap).toBe(-0.3)
  })

  it('Float P/L lấy từ trạng thái', () => {
    expect(summarizeAccount(state, [], false).floating).toBe(-25.13)
  })
})

describe('PositionsFooter', () => {
  it('hiện đủ Balance, Equity, Margin, Free margin, Swap và Tổng Float P/L', () => {
    render(
      <PositionsFooter state={state} positions={[pos(1, -0.5), pos(2, 0.2)]} live currency="USC" />,
    )
    const bar = screen.getByLabelText(strings.positionsSummary)
    const text = bar.textContent ?? ''
    for (const label of [
      strings.fieldBalance,
      strings.fieldEquity,
      strings.fieldMargin,
      strings.fieldMarginFree,
      strings.fieldSwap,
      strings.fieldFloatTotal,
    ]) {
      expect(within(bar).getByText(`${label}:`)).toBeTruthy()
    }
    expect(text).toContain('58,190.85')
    expect(text).toContain('−0.30')
    expect(text).toContain('−25.13')
  })
})
