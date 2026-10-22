import type { LinkStateView, LinkSummary } from '@az-sentinel/shared'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Dialog } from '../../components/Dialog'
import { ThemeToggle } from '../../components/ThemeToggle'
import { strings } from '../../lib/strings'
import { THEME_STORAGE_KEY } from '../../lib/theme'
import { json, me, renderApp } from '../../test/render-app'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

const NOW = Math.floor(Date.now() / 1000)

const state = (over: Partial<LinkStateView> = {}): LinkStateView => ({
  balance: 1000,
  equity: 1000,
  margin: 0,
  margin_free: 1000,
  margin_level: null,
  floating_pl: 0,
  last_reason: 'heartbeat',
  last_seen_at: NOW,
  last_seq: 1,
  ea_ver: null,
  vps_label: null,
  positions_count: 0,
  online: true,
  ...over,
})

function link(id: number, login: number, over: Partial<LinkSummary> = {}): LinkSummary {
  return {
    id,
    key_prefix: `k${id}`,
    status: 'active',
    created_at: NOW,
    bound_at: NOW,
    vps_name: `VPS-${id}`,
    account: {
      login,
      server: 'Demo-Srv',
      broker: null,
      name: `Name${id}`,
      currency: 'USD',
      mode: 'demo',
    },
    state: state(),
    ...over,
  }
}

const A = link(1, 1111111, { state: state({ equity: 500, floating_pl: -40 }) })
const B = link(2, 2222222, { state: state({ equity: 900, floating_pl: 10 }) })
const C = link(3, 3333333, { state: state({ online: false, equity: 100, floating_pl: null }) })
const D = link(4, 4444444, { account: null, state: null, vps_name: null })

const base = {
  'GET /api/me': () => json(200, me),
  'GET /api/health': () => json(200, { status: 'ok' }),
}
const open = (links: LinkSummary[]) =>
  renderApp('/links', { ...base, 'GET /api/links': () => json(200, { links }) })

/** Số tài khoản (7 chữ số) theo thứ tự các dòng của bảng. */
const order = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((r) => within(r).queryByText(/^\d{7}$/)?.textContent ?? '(chưa gắn)')

describe('dải tóm tắt', () => {
  it('đếm theo tình trạng: online, cần chú ý (offline), chờ EA', async () => {
    open([A, B, C, D])
    await screen.findByText('1111111')
    const box = screen.getByRole('region', { name: strings.summaryLabel })
    const text = box.textContent ?? ''
    expect(text).toContain(`4${strings.sumAccounts}`)
    expect(text).toContain(`2${strings.sumOnline}`)
    expect(text).toContain(`1${strings.sumAttention}`)
    expect(text).toContain(`1${strings.sumAwaiting}`)
    expect(within(box).queryByText(strings.sumAllGood)).toBeNull()
  })

  it('không có tài khoản nào cần chú ý thì báo ổn', async () => {
    open([A, B])
    await screen.findByText('1111111')
    expect(screen.getByText(strings.sumAllGood)).toBeTruthy()
  })

  it('tổng theo loại tiền chỉ hiện khi có từ 2 tài khoản cùng loại, không cộng gộp khác tiền tệ', async () => {
    const usc = link(5, 5555555, {
      account: {
        login: 5555555,
        server: 'S',
        broker: null,
        name: 'U',
        currency: 'USC',
        mode: 'real',
      },
      state: state({ equity: 7 }),
    })
    open([A, B, usc])
    await screen.findByText('1111111')
    const box = screen.getByRole('region', { name: strings.summaryLabel })
    // USD: 500 + 900 = 1,400; USC chỉ có 1 tài khoản nên không có dòng tổng.
    expect(within(box).getByText('1,400.00 USD')).toBeTruthy()
    expect(within(box).queryByText(/USC/)).toBeNull()
  })

  it('danh sách rỗng thì không hiện dải tóm tắt', async () => {
    open([])
    await screen.findByText(strings.linksEmpty)
    expect(screen.queryByRole('region', { name: strings.summaryLabel })).toBeNull()
  })
})

describe('lọc, tìm, sắp xếp', () => {
  it('mặc định sắp theo tên VPS; liên kết chưa có VPS xuống cuối', async () => {
    open([D, C, B, A])
    await screen.findByText('1111111')
    expect(order()).toEqual(['1111111', '2222222', '3333333', '(chưa gắn)'])
  })

  it('lọc "Cần chú ý" chỉ giữ dòng offline; bấm "Tất cả" trả lại', async () => {
    open([A, B, C, D])
    await screen.findByText('1111111')
    const attention = screen.getByRole('button', {
      name: new RegExp(`^${strings.filterAttention}`),
    })
    expect(attention.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(attention)
    expect(attention.getAttribute('aria-pressed')).toBe('true')
    expect(order()).toEqual(['3333333'])
    fireEvent.click(screen.getByRole('button', { name: strings.filterAll }))
    expect(order()).toHaveLength(4)
  })

  it('tìm theo số tài khoản; không khớp thì báo và có nút xóa bộ lọc', async () => {
    open([A, B, C])
    await screen.findByText('1111111')
    const box = screen.getByLabelText(strings.searchLabel)
    fireEvent.change(box, { target: { value: '2222' } })
    expect(order()).toEqual(['2222222'])

    fireEvent.change(box, { target: { value: 'khong-co-gi' } })
    expect(screen.getByText(strings.noMatch)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: strings.clearFilters }))
    expect(order()).toHaveLength(3)
    expect((box as HTMLInputElement).value).toBe('')
  })

  it('sắp theo equity cao nhất, lỗ nhiều nhất trước, cần chú ý trước', async () => {
    open([A, B, C])
    await screen.findByText('1111111')
    const sort = screen.getByLabelText(strings.sortLabel)
    fireEvent.change(sort, { target: { value: 'equity' } })
    expect(order()).toEqual(['2222222', '1111111', '3333333'])
    fireEvent.change(sort, { target: { value: 'pl' } })
    expect(order()).toEqual(['1111111', '2222222', '3333333']) // -40, +10, rồi thiếu số liệu
    fireEvent.change(sort, { target: { value: 'attention' } })
    expect(order()[0]).toBe('3333333') // offline lên đầu
  })
})

describe('huy hiệu tình trạng', () => {
  it('mỗi tình trạng có chữ riêng: Online, Offline, chờ EA, đã khóa', async () => {
    const disabled = link(6, 6666666, { status: 'disabled' })
    open([A, C, D, disabled])
    await screen.findByText('1111111')
    for (const t of [strings.online, strings.offline, strings.awaitingEa, strings.statusDisabled]) {
      expect(screen.getAllByText(t).length).toBeGreaterThan(0)
    }
  })

  it('chấm trạng thái chỉ là trang trí (aria-hidden), không đọc thành chữ', async () => {
    open([A])
    await screen.findByText('1111111')
    const badge = screen.getByText(strings.online).parentElement as HTMLElement
    expect(badge.textContent).toBe(strings.online)
    expect(badge.querySelector('[aria-hidden="true"]')).not.toBeNull()
  })
})

describe('đổi giao diện sáng/tối', () => {
  it('xoay vòng theo máy → sáng → tối → theo máy, đặt data-theme và nhớ lựa chọn', () => {
    render(<ThemeToggle />)
    const root = document.documentElement
    const btn = () => screen.getByRole('button', { name: new RegExp(strings.themeLabel) })
    expect(btn().getAttribute('aria-label')).toBe(
      `${strings.themeLabel}: ${strings.themeNames.system}`,
    )

    fireEvent.click(btn())
    expect(root.getAttribute('data-theme')).toBe('light')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')

    fireEvent.click(btn())
    expect(root.getAttribute('data-theme')).toBe('dark')
    expect(btn().getAttribute('aria-label')).toBe(
      `${strings.themeLabel}: ${strings.themeNames.dark}`,
    )

    fireEvent.click(btn())
    expect(root.hasAttribute('data-theme')).toBe(false)
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
  })

  it('localStorage hỏng thì vẫn đổi được, không văng lỗi', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    render(<ThemeToggle />)
    fireEvent.click(screen.getByRole('button', { name: new RegExp(strings.themeLabel) }))
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })
})

describe('hộp thoại', () => {
  function Host() {
    const [on, setOn] = useState(false)
    return (
      <>
        <button type="button" onClick={() => setOn(true)}>
          mở
        </button>
        {on && (
          <Dialog title="Tiêu đề" onClose={() => setOn(false)}>
            <button type="button">một</button>
            <button type="button">hai</button>
          </Dialog>
        )}
      </>
    )
  }

  beforeEach(() => {
    render(<Host />)
  })

  it('có role dialog, gắn tiêu đề, và đưa focus vào bên trong', () => {
    const opener = screen.getByRole('button', { name: 'mở' })
    opener.focus()
    fireEvent.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'Tiêu đề' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('Tab xoay vòng trong hộp (không thoát ra ngoài), Shift+Tab xoay ngược', () => {
    fireEvent.click(screen.getByRole('button', { name: 'mở' }))
    const one = screen.getByRole('button', { name: 'một' })
    const two = screen.getByRole('button', { name: 'hai' })
    two.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(one)
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(two)
  })

  it('Esc đóng hộp và trả focus về nút đã mở', async () => {
    const opener = screen.getByRole('button', { name: 'mở' })
    opener.focus()
    fireEvent.click(opener)
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(opener)
  })
})
