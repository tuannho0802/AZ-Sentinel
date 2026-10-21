import type { LinkStateView, LinkSummary } from '@az-sentinel/shared'
import { describe, expect, it } from 'vitest'
import { applyView, classify, DEFAULT_VIEW, type LinkRow, summarize } from './links-view'

const NOW = 1_800_000_000

const state = (over: Partial<LinkStateView> = {}): LinkStateView => ({
  balance: 1000,
  equity: 1000,
  margin: 0,
  margin_free: 1000,
  margin_level: null,
  floating_pl: 0,
  last_reason: null,
  last_seen_at: NOW,
  last_seq: 1,
  ea_ver: null,
  vps_label: null,
  positions_count: 0,
  online: true,
  ...over,
})

function link(id: number, over: Partial<LinkSummary> = {}): LinkSummary {
  return {
    id,
    key_prefix: `k${id}`,
    status: 'active',
    created_at: NOW,
    bound_at: NOW,
    vps_name: null,
    account: {
      login: 1000 + id,
      server: 'Srv',
      broker: null,
      name: null,
      currency: 'USD',
      mode: 'demo',
    },
    state: state(),
    ...over,
  }
}

const row = (l: LinkSummary, liveState: LinkRow['liveState'] = null): LinkRow => ({
  raw: l,
  link: l,
  liveState,
  health: classify(l, liveState),
})

const ids = (rows: LinkRow[]) => rows.map((r) => r.link.id)

describe('classify', () => {
  it('khóa thắng mọi trạng thái khác', () => {
    expect(classify(link(1, { status: 'disabled' }), 'live')).toBe('disabled')
  })
  it('chưa có dữ liệu thì chờ EA; offline do server báo', () => {
    expect(classify(link(1, { state: null }), null)).toBe('awaiting')
    expect(classify(link(1, { state: state({ online: false }) }), 'live')).toBe('offline')
  })
  it('theo trạng thái live khi đã nối', () => {
    const l = link(1)
    expect(classify(l, 'live')).toBe('live')
    expect(classify(l, 'idle')).toBe('silent')
    expect(classify(l, 'waking')).toBe('waking')
    expect(classify(l, null)).toBe('online')
  })
})

describe('applyView', () => {
  const rows = [
    row(link(1, { vps_name: 'VPS-B', state: state({ equity: 500, floating_pl: -40 }) })),
    row(link(2, { vps_name: 'VPS-A', state: state({ equity: 900, floating_pl: 10 }) })),
    row(
      link(3, { vps_name: null, state: state({ online: false, equity: 100, floating_pl: null }) }),
    ),
  ]
  it('mặc định sắp theo VPS (A trước B), VPS trống xuống cuối', () => {
    expect(ids(applyView(rows, DEFAULT_VIEW))).toEqual([2, 1, 3])
  })
  it('lọc "cần chú ý" chỉ giữ liên kết offline hoặc im', () => {
    expect(ids(applyView(rows, { ...DEFAULT_VIEW, filter: 'attention' }))).toEqual([3])
  })
  it('tìm theo số tài khoản, không phân biệt hoa thường', () => {
    expect(ids(applyView(rows, { ...DEFAULT_VIEW, query: '1002' }))).toEqual([2])
    expect(ids(applyView(rows, { ...DEFAULT_VIEW, query: 'vps-b' }))).toEqual([1])
  })
  it('sắp "cần chú ý trước" đưa offline lên đầu', () => {
    expect(applyView(rows, { ...DEFAULT_VIEW, sort: 'attention' })[0]?.link.id).toBe(3)
  })
  it('sắp equity giảm dần; lỗ nhiều nhất trước, thiếu số liệu xuống cuối', () => {
    expect(ids(applyView(rows, { ...DEFAULT_VIEW, sort: 'equity' }))).toEqual([2, 1, 3])
    expect(ids(applyView(rows, { ...DEFAULT_VIEW, sort: 'pl' }))).toEqual([1, 2, 3])
  })
  it('không làm thay đổi mảng đầu vào', () => {
    const before = ids(rows)
    applyView(rows, { ...DEFAULT_VIEW, sort: 'equity' })
    expect(ids(rows)).toEqual(before)
  })
})

describe('summarize', () => {
  it('đếm theo tình trạng và chỉ cộng tổng cho loại tiền có từ 2 tài khoản', () => {
    const rows = [
      row(link(1, { state: state({ equity: 100, floating_pl: 5.5 }) }), 'live'),
      row(link(2, { state: state({ equity: 200, floating_pl: -2 }) })),
      row(link(3, { state: state({ online: false }) })),
      row(link(4, { state: null })),
      row(link(5, { status: 'disabled' })),
      row(
        link(6, {
          account: {
            login: 9,
            server: 'S',
            broker: null,
            name: null,
            currency: 'USC',
            mode: 'real',
          },
          state: state({ equity: 7 }),
        }),
      ),
    ]
    const s = summarize(rows)
    expect(s).toMatchObject({
      total: 6,
      live: 1,
      online: 3,
      attention: 1,
      awaiting: 1,
      disabled: 1,
    })
    // USD: tài khoản 1, 2, 3 có số liệu (5 bị khóa nên loại); USC chỉ có 1 nên không có tổng.
    expect(s.totals).toEqual([{ currency: 'USD', count: 3, equity: 1300, pl: 3.5 }])
  })
})
