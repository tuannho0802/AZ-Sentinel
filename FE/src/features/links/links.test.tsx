import type { CreateLinkResponse, LinkDetail, LinkSummary } from '@az-sentinel/shared'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { strings } from '../../lib/strings'
import { json, me, renderApp } from '../../test/render-app'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const NOW = Math.floor(Date.now() / 1000)

const unbound: LinkSummary = {
  id: 1,
  key_prefix: 'abcd1234',
  status: 'active',
  created_at: NOW,
  bound_at: null,
  account: null,
  state: null,
}

const bound: LinkSummary = {
  id: 2,
  key_prefix: 'wxyz9876',
  status: 'active',
  created_at: NOW,
  bound_at: NOW,
  account: {
    login: 5550001,
    server: 'Demo-Srv',
    broker: 'Broker <b>X</b>',
    name: 'Tester',
    currency: 'USD',
    mode: 'demo',
  },
  state: {
    balance: 1000,
    equity: 1012.5,
    margin: 0,
    margin_free: 1012.5,
    margin_level: null,
    floating_pl: 12.5,
    last_reason: 'heartbeat',
    last_seen_at: NOW,
    last_seq: 7,
    ea_ver: 'spike-0.01',
    vps_label: 'LOCAL',
    positions_count: 1,
    online: true,
  },
}

const detail: LinkDetail = {
  ...bound,
  positions: [
    {
      ticket: 77,
      symbol: 'XAUUSD',
      type: 'buy',
      volume: 0.1,
      time: NOW,
      price: 4010.1,
      profit: -3.2,
    },
  ],
  events: [{ id: 1, ts: NOW, type: 'auth_fail', detail: { reason: 'account_mismatch' } }],
}

const base = {
  'GET /api/me': () => json(200, me),
  'GET /api/health': () => json(200, { status: 'ok' }),
}

describe('danh sách liên kết', () => {
  it('rỗng: giải thích và hướng dẫn bước tiếp theo', async () => {
    renderApp('/links', { ...base, 'GET /api/dev/links': () => json(200, { links: [] }) })
    expect(await screen.findByText(strings.linksEmpty)).toBeTruthy()
    expect(screen.getByText(strings.linksEmptyHint)).toBeTruthy()
  })

  it('hiện liên kết chưa gắn và đã gắn (online, equity, lãi/lỗ có dấu)', async () => {
    renderApp('/links', {
      ...base,
      'GET /api/dev/links': () => json(200, { links: [bound, unbound] }),
    })
    expect(await screen.findByText('5550001')).toBeTruthy()
    expect(screen.getByText(strings.unbound)).toBeTruthy()
    expect(screen.getByText(strings.awaitingEa)).toBeTruthy()
    expect(screen.getByText(`● ${strings.online}`)).toBeTruthy()
    expect(screen.getByText('1,012.50 USD')).toBeTruthy()
    expect(screen.getByText('+12.50 USD')).toBeTruthy()
    expect(screen.getByText('Tester')).toBeTruthy()
    expect(screen.queryByText(/wxyz9876/)).toBeNull()
    expect(screen.queryByText(/abcd1234/)).toBeNull()
  })

  it('API dev chưa bật (404): báo cách bật, không cho tạo', async () => {
    renderApp('/links', {
      ...base,
      'GET /api/dev/links': () =>
        json(404, { error: { code: 'NOT_FOUND', message: 'Không tìm thấy' } }),
    })
    expect(await screen.findByText(strings.linksDevOff)).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: strings.linkCreate }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('lỗi hệ thống: hiện lỗi và nút thử lại, bấm thì hồi phục', async () => {
    let ok = false
    renderApp('/links', {
      ...base,
      'GET /api/dev/links': () =>
        ok ? json(200, { links: [] }) : json(500, { error: { code: 'INTERNAL', message: 'x' } }),
    })
    expect(await screen.findByText(strings.linksError)).toBeTruthy()
    ok = true
    fireEvent.click(screen.getByRole('button', { name: strings.retry }))
    expect(await screen.findByText(strings.linksEmpty)).toBeTruthy()
  })
})

describe('tạo liên kết', () => {
  it('hiện khóa một lần rồi biến mất khi đóng, danh sách được làm mới', async () => {
    let listed = 0
    const created: CreateLinkResponse = { link: unbound, api_key: 'SECRET-KEY-VALUE-1234567890' }
    renderApp('/links', {
      ...base,
      'GET /api/dev/links': () => {
        listed += 1
        return json(200, { links: listed > 1 ? [unbound] : [] })
      },
      'POST /api/dev/links': () => json(201, created),
    })
    fireEvent.click(await screen.findByRole('button', { name: strings.linkCreate }))
    const dialog = await screen.findByRole('dialog')
    expect((within(dialog).getByLabelText(strings.keyLabel) as HTMLInputElement).value).toBe(
      created.api_key,
    )
    expect(
      (within(dialog).getByLabelText(strings.ingestUrlLabel) as HTMLInputElement).value,
    ).toContain('/api/ea/v1/ingest')
    fireEvent.click(within(dialog).getByRole('button', { name: strings.close }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.queryByDisplayValue(created.api_key)).toBeNull()
    expect(await screen.findByText(strings.awaitingEa)).toBeTruthy()
  })

  it('tạo lỗi thì báo lỗi, không hiện hộp thoại', async () => {
    renderApp('/links', {
      ...base,
      'GET /api/dev/links': () => json(200, { links: [] }),
      'POST /api/dev/links': () =>
        json(400, { error: { code: 'VALIDATION_FAILED', message: 'Đã đạt giới hạn 20 liên kết' } }),
    })
    fireEvent.click(await screen.findByRole('button', { name: strings.linkCreate }))
    expect((await screen.findByRole('alert')).textContent).toContain('Đã đạt giới hạn 20 liên kết')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('chi tiết liên kết', () => {
  it('hiện tài khoản, số liệu, lệnh đang mở, sự kiện; văn bản EA gửi không bị diễn giải thành HTML', async () => {
    renderApp('/links/2', { ...base, 'GET /api/dev/links/2': () => json(200, detail) })
    expect(await screen.findByText('Broker <b>X</b>')).toBeTruthy()
    expect(screen.getByText('XAUUSD')).toBeTruthy()
    expect(screen.getByText('−3.20 USD')).toBeTruthy()
    expect(screen.getByText('auth_fail')).toBeTruthy()
    expect(document.querySelector('b')).toBeNull()
  })

  it('chưa nhận dữ liệu: hướng dẫn gắn EA', async () => {
    renderApp('/links/1', {
      ...base,
      'GET /api/dev/links/1': () => json(200, { ...unbound, positions: [], events: [] }),
    })
    expect(await screen.findByText(strings.waitingFirst)).toBeTruthy()
    expect(screen.getByText(strings.positionsEmpty)).toBeTruthy()
    expect(screen.getByText(strings.eventsEmpty)).toBeTruthy()
  })

  it('không tìm thấy (404) và id sai định dạng', async () => {
    renderApp('/links/9', {
      ...base,
      'GET /api/dev/links/9': () => json(404, { error: { code: 'NOT_FOUND', message: 'x' } }),
    })
    expect(await screen.findByText(strings.detailNotFound)).toBeTruthy()
    cleanup()
    renderApp('/links/abc', base)
    expect(await screen.findByText(strings.notFoundTitle)).toBeTruthy()
  })

  it('xóa cần xác nhận; từ chối thì không gọi API', async () => {
    const del = vi.fn(() => new Response(null, { status: 204 }))
    renderApp('/links/2', {
      ...base,
      'GET /api/dev/links/2': () => json(200, detail),
      'DELETE /api/dev/links/2': del,
      'GET /api/dev/links': () => json(200, { links: [] }),
    })
    const btn = await screen.findByRole('button', { name: strings.actDelete })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(btn)
    expect(confirm).toHaveBeenCalledWith(strings.confirmDelete)
    expect(del).not.toHaveBeenCalled()
    confirm.mockReturnValue(true)
    fireEvent.click(btn)
    await waitFor(() => expect(del).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(strings.linksEmpty)).toBeTruthy()
  })

  it('khóa liên kết gọi đúng API sau xác nhận', async () => {
    const setStatus = vi.fn(() => json(200, { ...bound, status: 'disabled' }))
    const { fetchMock } = renderApp('/links/2', {
      ...base,
      'GET /api/dev/links/2': () => json(200, detail),
      'POST /api/dev/links/2/status': setStatus,
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(await screen.findByRole('button', { name: strings.actDisable }))
    await waitFor(() => expect(setStatus).toHaveBeenCalledTimes(1))
    const call = fetchMock.mock.calls.find(([url]) => url === '/api/dev/links/2/status')
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ status: 'disabled' })
  })
})

describe('cấp lại khóa', () => {
  it('xác nhận rồi hiện khóa mới có nút copy; từ chối thì không gọi API', async () => {
    const rotate = vi.fn(() =>
      json(200, { link: bound, api_key: 'NEW-KEY-VALUE-ABCDEFGHIJKLMNOP' }),
    )
    renderApp('/links', {
      ...base,
      'GET /api/dev/links': () => json(200, { links: [bound] }),
      'POST /api/dev/links/2/rotate-key': rotate,
    })
    const btn = await screen.findByRole('button', { name: strings.rotateKey })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(btn)
    expect(confirm).toHaveBeenCalledWith(strings.confirmRotate)
    expect(rotate).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()

    confirm.mockReturnValue(true)
    fireEvent.click(btn)
    const dialog = await screen.findByRole('dialog')
    expect((within(dialog).getByLabelText(strings.keyLabel) as HTMLInputElement).value).toBe(
      'NEW-KEY-VALUE-ABCDEFGHIJKLMNOP',
    )
    expect(within(dialog).getByRole('button', { name: strings.copyKey })).toBeTruthy()
    expect(within(dialog).getByText(strings.rotateDialogWarning)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: strings.close }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.queryByDisplayValue('NEW-KEY-VALUE-ABCDEFGHIJKLMNOP')).toBeNull()
  })

  it('có nút cấp lại khóa ở trang chi tiết; lỗi thì báo lỗi', async () => {
    renderApp('/links/2', {
      ...base,
      'GET /api/dev/links/2': () => json(200, detail),
      'POST /api/dev/links/2/rotate-key': () =>
        json(500, { error: { code: 'INTERNAL', message: 'x' } }),
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(await screen.findByRole('button', { name: strings.rotateKey }))
    expect((await screen.findByText(strings.rotateFailed)).textContent).toBe(strings.rotateFailed)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('điều hướng', () => {
  it('menu có mục Liên kết EA dẫn tới danh sách', async () => {
    renderApp('/', { ...base, 'GET /api/dev/links': () => json(200, { links: [] }) })
    fireEvent.click(await screen.findByRole('link', { name: strings.navLinks }))
    expect(await screen.findByText(strings.linksEmpty)).toBeTruthy()
  })
})
