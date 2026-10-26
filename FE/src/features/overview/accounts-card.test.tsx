import type { LinkSummary } from '@az-sentinel/shared'
import { cleanup, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { strings } from '../../lib/strings'
import { json, me, renderApp } from '../../test/render-app'
import { OVERVIEW_ACCOUNT_LIMIT } from './AccountsCard'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const NOW = Math.floor(Date.now() / 1000)
const link = (id: number, over: Partial<LinkSummary> = {}): LinkSummary => ({
  id,
  key_prefix: `k${id}`,
  status: 'active',
  created_at: NOW,
  bound_at: NOW,
  vps_name: `A${id}`,
  account: {
    login: 1000 + id,
    server: 'Srv',
    broker: `Broker${id}`,
    name: `Acc${id}`,
    currency: 'USD',
    mode: 'live',
  },
  state: {
    balance: 500 + id,
    equity: 500,
    margin: 0,
    margin_free: 500,
    margin_level: null,
    floating_pl: 0,
    last_reason: null,
    last_seen_at: NOW - id * 10,
    last_seq: 1,
    ea_ver: null,
    vps_label: null,
    positions_count: 0,
    online: id % 2 === 1,
  },
  ...over,
})

const phone = () =>
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))

const boot = (links: LinkSummary[]) =>
  renderApp('/', {
    'GET /api/me': () => json(200, me),
    'GET /api/health': () => json(200, { status: 'ok' }),
    'GET /api/links': () => json(200, { links }),
  })

describe('Tổng quan: tài khoản MT5 đang kết nối', () => {
  it('hiện Online/Offline, tên + broker, VPS và Balance; mới cập nhật lên đầu', async () => {
    boot([link(2), link(1)])
    const card = (await screen.findByText(strings.accountsCardTitle)).closest('section')
    if (!card) throw new Error('thiếu thẻ')
    const body = within(card)
    expect(await body.findByText('Acc1')).toBeTruthy()
    expect(body.getAllByText(strings.online).length).toBe(1)
    expect(body.getAllByText(strings.offline).length).toBe(1)
    expect(body.getByText('A1')).toBeTruthy()
    const names = body.getAllByText(/^Acc\d$/).map((n) => n.textContent)
    expect(names).toEqual(['Acc1', 'Acc2'])
    expect(body.queryByRole('link', { name: new RegExp(strings.accountsMore) })).toBeNull()
  })

  it('chỉ lấy số tài khoản giới hạn và có nút Xem thêm sang trang Liên kết', async () => {
    const many = Array.from({ length: OVERVIEW_ACCOUNT_LIMIT + 3 }, (_, i) => link(i + 1))
    boot(many)
    const more = await screen.findByRole('link', { name: new RegExp(strings.accountsMore) })
    expect(more.getAttribute('href')).toBe('/links')
    expect(more.textContent).toContain('(3)')
    expect(screen.getAllByText(/^Acc\d+$/).length).toBe(OVERVIEW_ACCOUNT_LIMIT)
  })

  it('điện thoại: danh sách xếp dọc, không có bảng', async () => {
    phone()
    boot([link(1)])
    const list = await screen.findByRole('list', { name: strings.accountsCardTitle })
    expect(screen.queryByRole('table')).toBeNull()
    expect(within(list).getByText('Acc1')).toBeTruthy()
  })

  it('đã gộp thẻ Liên kết EA: chỉ còn một thẻ, có nút Quản lý liên kết EA', async () => {
    boot([link(1)])
    const manage = await screen.findByRole('link', { name: strings.linksManage })
    expect(manage.getAttribute('href')).toBe('/links')
    expect(screen.queryByText(strings.linksTitle, { selector: 'h2' })).toBeNull()
  })

  it('chưa có tài khoản: báo trống', async () => {
    boot([])
    expect(await screen.findByText(new RegExp(strings.accountsCardEmpty))).toBeTruthy()
  })
})
