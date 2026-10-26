import type { LinkSummary } from '@az-sentinel/shared'
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CARD_MODE_STORAGE_KEY } from '../../lib/card-mode'
import { strings } from '../../lib/strings'
import { json, me, renderApp } from '../../test/render-app'

/** Giả lập điện thoại: `(min-width: 48rem)` không khớp nên danh sách vẽ thẻ thay vì bảng. */
function phone() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const NOW = Math.floor(Date.now() / 1000)
const row = (over: Partial<LinkSummary> = {}): LinkSummary => ({
  id: 2,
  key_prefix: 'wxyz9876',
  status: 'active',
  created_at: NOW,
  bound_at: NOW,
  vps_name: 'VPS-A01',
  account: {
    login: 32449237,
    server: 'BCR-MT5',
    broker: 'Broker',
    name: 'Nguyen My Loc',
    currency: 'USD',
    mode: 'real',
  },
  state: {
    balance: 102328.9,
    equity: 102293.01,
    margin: 0,
    margin_free: 102293.01,
    margin_level: null,
    floating_pl: -35.89,
    last_reason: 'heartbeat',
    last_seen_at: NOW,
    last_seq: 7,
    ea_ver: '0.3.0',
    vps_label: 'A3',
    positions_count: 1,
    online: true,
  },
  ...over,
})

const base = (links: LinkSummary[]) => ({
  'GET /api/me': () => json(200, me),
  'GET /api/links': () => json(200, { links }),
})

async function cards() {
  const list = await screen.findByRole('list', { name: strings.linksPageTitle })
  return within(list)
}

describe('Liên kết EA trên điện thoại: thẻ gọn và thẻ chi tiết', () => {
  it('mặc định là thẻ gọn: chỉ số TK + sàn/tên, Balance, Lãi/lỗ, VPS', async () => {
    phone()
    renderApp('/links', base([row()]))
    const card = await cards()

    expect(card.getByText('32449237')).toBeTruthy()
    expect(card.getByText('BCR-MT5 · Nguyen My Loc')).toBeTruthy()
    expect(card.getByText(strings.colBalance)).toBeTruthy()
    expect(card.getByText(strings.colPl)).toBeTruthy()
    expect(card.getByText('VPS-A01')).toBeTruthy()

    // Đã thu gọn: không Equity, không lần nhận gần nhất, không nút thao tác, không sửa VPS tại chỗ.
    expect(card.queryByText(strings.colEquity)).toBeNull()
    expect(card.queryByText(strings.colLastSeen)).toBeNull()
    expect(card.queryByRole('button')).toBeNull()

    const toggle = screen.getByRole('button', { name: strings.cardModeCompact })
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(
      screen.getByRole('button', { name: strings.cardModeDetailed }).getAttribute('aria-pressed'),
    ).toBe('false')
  })

  it('thẻ gọn là một liên kết sang trang chi tiết, có chữ tình trạng cho trình đọc màn hình', async () => {
    phone()
    renderApp('/links', base([row()]))
    const card = await cards()
    const link = card.getByRole('link')
    expect(link.getAttribute('href')).toBe('/links/2')
    expect(link.textContent).toContain('32449237')
    expect(link.textContent).toContain(strings.online)
  })

  it('bấm Card chi tiết thì ra đủ thông tin như trước và nhớ lựa chọn', async () => {
    phone()
    renderApp('/links', base([row()]))
    await cards()
    fireEvent.click(screen.getByRole('button', { name: strings.cardModeDetailed }))

    const card = await cards()
    expect(card.getByText(strings.colEquity)).toBeTruthy()
    expect(card.getByText(strings.colLastSeen)).toBeTruthy()
    expect(card.getByRole('link', { name: strings.viewDetail })).toBeTruthy()
    expect(card.getByRole('button', { name: strings.rotateKey })).toBeTruthy()
    expect(localStorage.getItem(CARD_MODE_STORAGE_KEY)).toBe('detailed')
  })

  it('lần sau mở lại vẫn đúng kiểu đã chọn trước đó', async () => {
    phone()
    localStorage.setItem(CARD_MODE_STORAGE_KEY, 'detailed')
    renderApp('/links', base([row()]))
    const card = await cards()
    expect(card.getByText(strings.colEquity)).toBeTruthy()
    expect(
      screen.getByRole('button', { name: strings.cardModeDetailed }).getAttribute('aria-pressed'),
    ).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: strings.cardModeCompact }))
    expect((await cards()).queryByText(strings.colEquity)).toBeNull()
    expect(localStorage.getItem(CARD_MODE_STORAGE_KEY)).toBe('compact')
  })

  it('tên VPS và tên tài khoản hiện dạng văn bản thuần, không chạy HTML', async () => {
    phone()
    const xss = '<img src=x onerror=alert(1)>'
    renderApp(
      '/links',
      base([
        row({
          vps_name: xss,
          account: {
            login: 1,
            server: 'S',
            broker: 'B',
            name: '<b>x</b>',
            currency: 'USD',
            mode: 'real',
          },
        }),
      ]),
    )
    const card = await cards()
    expect(card.getByText(xss)).toBeTruthy()
    expect(card.getByText('S · <b>x</b>')).toBeTruthy()
    expect(document.querySelector('img')).toBeNull()
  })

  it('tài khoản chưa gắn vẫn có thẻ gọn, VPS trống hiện dấu gạch', async () => {
    phone()
    renderApp('/links', base([row({ account: null, state: null, vps_name: null })]))
    const card = await cards()
    expect(card.getByText(strings.unbound)).toBeTruthy()
    expect(card.getByText(strings.colVps).nextElementSibling?.textContent).toBe('—')
  })

  it('màn hình rộng vẫn là bảng, không có nút chọn kiểu thẻ', async () => {
    renderApp('/links', base([row()]))
    expect(await screen.findByRole('table')).toBeTruthy()
    expect(screen.queryByRole('button', { name: strings.cardModeCompact })).toBeNull()
  })
})
