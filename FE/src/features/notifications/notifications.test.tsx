import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { strings } from '../../lib/strings'
import { json, me, renderApp } from '../../test/render-app'
import { parseLossPct } from './AlertSettingsForm'

afterEach(cleanup)

const NOW = Math.floor(Date.now() / 1000)
const notif = (over: Record<string, unknown> = {}) => ({
  id: 'uid-00000001',
  kind: 'warn',
  title: 'Cảnh báo lỗ float',
  body: 'Tài khoản 1234 đang lỗ float -600 USC (6% Balance).',
  link_id: 7,
  created_at: NOW - 120,
  read: false,
  data: {},
  ...over,
})

function open(
  opts: {
    items?: unknown[]
    unread?: number
    settings?: { loss_pct: number; growth_mode: 'balance' | 'float' }
    putStatus?: number
  } = {},
) {
  const settings = opts.settings ?? { loss_pct: 0, growth_mode: 'balance' as const }
  const items = opts.items ?? []
  const view = renderApp('/', {
    'GET /api/me': () => json(200, me),
    'GET /api/health': () => json(200, { status: 'ok' }),
    'GET /api/links': () => json(200, { links: [] }),
    'GET /api/notifications?limit=30': () =>
      json(200, {
        items,
        unread: opts.unread ?? items.filter((i) => !(i as { read: boolean }).read).length,
      }),
    'POST /api/notifications/read': () => json(200, { unread: 0 }),
    'GET /api/settings/alerts': () => json(200, settings),
    'PUT /api/settings/alerts': () =>
      opts.putStatus && opts.putStatus !== 200
        ? json(opts.putStatus, {
            error: {
              code: 'READ_ONLY_FALLBACK',
              message: 'Đang chạy dự phòng trên Cloudflare: tạm thời chỉ cho xem, tạm khóa ghi',
            },
          })
        : json(200, { loss_pct: 5, growth_mode: 'float' }),
  })
  return { view }
}

const bell = (unread: number) =>
  screen.findByRole('button', { name: strings.notifBellLabel(unread) })

describe('chuông thông báo', () => {
  it('không có thông báo: chuông không có số, mở ra thấy trạng thái rỗng', async () => {
    open()
    fireEvent.click(await bell(0))
    expect(await screen.findByText(strings.notifEmpty)).toBeTruthy()
  })

  it('có thông báo chưa đọc: huy hiệu hiện số, danh sách hiện nội dung dạng văn bản thuần', async () => {
    const script = '<script>alert(1)</script>'
    open({ items: [notif(), notif({ id: 'uid-00000002', body: script, read: true })] })
    fireEvent.click(await bell(1))
    expect(await screen.findByText(/lỗ float -600 USC/)).toBeTruthy()
    expect(screen.getByText(script)).toBeTruthy() // hiện nguyên chữ, không chạy
    expect(document.querySelector('#notif-panel script')).toBeNull()
  })

  it('bấm "Đọc tất cả" gọi API với { all: true }', async () => {
    const { view } = open({ items: [notif()] })
    fireEvent.click(await bell(1))
    fireEvent.click(await screen.findByRole('button', { name: strings.notifMarkAll }))
    await waitFor(() => {
      const call = view.fetchMock.mock.calls.find(
        ([url, init]) => url === '/api/notifications/read' && init?.method === 'POST',
      )
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({ all: true })
    })
  })

  it('bấm vào một thông báo chưa đọc đánh dấu đã đọc theo id và mở liên kết', async () => {
    const { view } = open({ items: [notif()] })
    fireEvent.click(await bell(1))
    fireEvent.click(await screen.findByRole('button', { name: /Cảnh báo lỗ float/ }))
    await waitFor(() => {
      const call = view.fetchMock.mock.calls.find(
        ([url, init]) => url === '/api/notifications/read' && init?.method === 'POST',
      )
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({ ids: ['uid-00000001'] })
    })
  })

  it('Esc đóng bảng', async () => {
    open()
    fireEvent.click(await bell(0))
    await screen.findByRole('dialog', { name: strings.notifTitle })
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

describe('cài đặt cảnh báo', () => {
  async function openSettings() {
    fireEvent.click(await bell(0))
    fireEvent.click(await screen.findByRole('button', { name: strings.notifOpenSettings }))
    return screen.findByLabelText(strings.alertThresholdLabel)
  }

  it('mặc định hiện 0 (tắt) và chế độ "Balance hiện tại"', async () => {
    open()
    const input = (await openSettings()) as HTMLInputElement
    expect(input.value).toBe('0')
    const balance = screen.getByRole('radio', { name: new RegExp(strings.alertModeBalance) })
    expect((balance as HTMLInputElement).checked).toBe(true)
  })

  it('đổi sang "Float P/L" và lưu: gửi loss_pct và growth_mode', async () => {
    const { view } = open()
    const input = await openSettings()
    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(strings.alertModeFloat) }))
    fireEvent.click(screen.getByRole('button', { name: strings.alertSave }))
    await waitFor(() => {
      const call = view.fetchMock.mock.calls.find(
        ([url, init]) => url === '/api/settings/alerts' && init?.method === 'PUT',
      )
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({ loss_pct: 5, growth_mode: 'float' })
    })
    expect(await screen.findByText(strings.alertSaved)).toBeTruthy()
  })

  it('giá trị sai thì báo lỗi và không gọi API', async () => {
    const { view } = open()
    const input = await openSettings()
    fireEvent.change(input, { target: { value: '0,05' } })
    fireEvent.click(screen.getByRole('button', { name: strings.alertSave }))
    expect(await screen.findByText(strings.alertInvalid)).toBeTruthy()
    expect(view.fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
  })

  it('đang chạy dự phòng: hiện thông báo lỗi do máy chủ trả về', async () => {
    open({ putStatus: 503 })
    const input = await openSettings()
    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: strings.alertSave }))
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(/tạm khóa ghi/)).toBeTruthy()
    // Lỗi nằm trong ô cài đặt, không phải lỗi toàn trang "Không gọi được API".
    expect(screen.queryByText(strings.apiError)).toBeNull()
  })
})

describe('parseLossPct', () => {
  it.each([
    ['5', 5],
    ['5,5', 5.5],
    [' 7.25 ', 7.25],
    ['0', 0],
    ['0,1', 0.1],
    ['100', 100],
  ])('"%s" hợp lệ', (text, expected) => expect(parseLossPct(text)).toBe(expected))

  it.each(['', 'abc', '0,05', '-1', '101', 'NaN'])('"%s" không hợp lệ', (text) =>
    expect(parseLossPct(text)).toBeNull(),
  )
})
