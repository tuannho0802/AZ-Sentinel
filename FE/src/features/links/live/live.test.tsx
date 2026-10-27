import type { LinkSummary } from '@az-sentinel/shared'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { strings } from '../../../lib/strings'
import { FakeWebSocket } from '../../../test/fake-websocket'
import { json, me, renderApp } from '../../../test/render-app'
import { HEALTH_DOWNGRADE_GRACE_MS } from '../health-stabilizer'
import { resetHealthStabilizer } from '../links-view'
import { clearLive } from './live-store'
import { BACKOFF_SECONDS, HEARTBEAT_MS, PAUSED_STORAGE_KEY } from './useLiveLease'

const NOW = Math.floor(Date.now() / 1000)
const link: LinkSummary = {
  id: 2,
  key_prefix: 'wxyz9876',
  status: 'active',
  created_at: NOW,
  bound_at: NOW,
  vps_name: null,
  account: {
    login: 5550001,
    server: 'Demo-Srv',
    broker: 'B',
    name: 'Tester',
    currency: 'USD',
    mode: 'demo',
  },
  state: {
    balance: 1000,
    equity: 1010,
    margin: 0,
    margin_free: 1010,
    margin_level: null,
    floating_pl: 10,
    last_reason: 'heartbeat',
    last_seen_at: NOW,
    last_seq: 1,
    ea_ver: 'x',
    vps_label: 'V',
    positions_count: 0,
    online: true,
  },
}
const sample = (over: Record<string, unknown> = {}) => ({
  t: NOW,
  eq: 1234,
  bal: 1000,
  fl: 55.5,
  ml: null,
  ...over,
})
const samplesMsg = (over: Record<string, unknown> = {}) => ({
  t: 'samples',
  id: 2,
  server_time: NOW,
  samples: [sample(over)],
})
const snapshot = (state: string, s: unknown = null) => ({
  t: 'snapshot',
  server_time: NOW,
  links: [{ id: 2, live_state: state, sample: s }],
})

let listCalls = 0
const handlers = () => ({
  'GET /api/me': () => json(200, me),
  'GET /api/health': () => json(200, { status: 'ok' }),
  'GET /api/links': () => {
    listCalls += 1
    return json(200, { links: [link] })
  },
  'GET /api/links/2': () => json(200, { ...link, positions: [], events: [] }),
})

const sock = () => FakeWebSocket.instances.at(-1) as FakeWebSocket
const open = async () => {
  await waitFor(() => expect(FakeWebSocket.live.length).toBe(1))
  await act(async () => sock().serverOpen())
  return sock()
}
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
const setVisibility = (state: 'hidden' | 'visible') => {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  listCalls = 0
  localStorage.clear()
  clearLive()
  resetHealthStabilizer()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  setVisibility('visible')
  localStorage.clear()
})

describe('mở/đóng kết nối (F-01..F-08, F-16, F-19)', () => {
  it('F-01: vào /links gọi danh sách 1 lần, mở đúng 1 WebSocket, gửi hello', async () => {
    renderApp('/links', handlers())
    await screen.findByText('5550001')
    const s = await open()
    expect(listCalls).toBe(1)
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(s.url).toContain('/api/live/ws?scope=links')
    expect(s.messages).toContainEqual({ t: 'hello', scope: 'links' })
  })

  it('chi tiết /links/:id: mở đúng 1 WebSocket phạm vi một liên kết, gửi hello kèm id', async () => {
    renderApp('/links/2', handlers())
    await screen.findByText(strings.accountTitle)
    const s = await open()
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(s.url).toContain('/api/live/ws?scope=link&id=2')
    expect(s.messages).toContainEqual({ t: 'hello', scope: 'link', id: 2 })
  })

  it('chi tiết: lãi/lỗ từng lệnh đổi theo pl, Live thay cho "X giây trước", không gọi lại D1', async () => {
    let detailCalls = 0
    renderApp('/links/2', {
      ...handlers(),
      'GET /api/links/2': () => {
        detailCalls += 1
        return json(200, {
          ...link,
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
          events: [],
        })
      },
    })
    await screen.findByText('XAUUSD')
    const s = await open()
    act(() => s.serverSend({ ...samplesMsg(), pl: { '77': 4.92 } }))
    // Bảng lệnh, ô "Lãi/lỗ đang mở" và dòng tổng dưới bảng khớp nhau: cả ba là +4.92 (không còn lệch với fl của mẫu).
    await waitFor(() => expect(screen.getAllByText('+4.92 USD')).toHaveLength(3))
    expect(screen.queryByText('+55.50 USD')).toBeNull()
    expect(screen.getByText(strings.badgeLive)).toBeTruthy()
    expect(screen.queryByText(new RegExp(strings.updatedAt))).toBeNull() // đang live: ẩn giờ tải D1
    expect(detailCalls).toBe(1)
  })

  it('F-02: tổng quan và chưa đăng nhập đều không mở WebSocket', async () => {
    renderApp('/', handlers())
    await screen.findAllByText(strings.overviewTitle)
    cleanup()
    renderApp('/links', {
      ...handlers(),
      'GET /api/me': () => json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }),
    })
    await screen.findByText(strings.loginTitle, { selector: 'h2' })
    expect(FakeWebSocket.instances).toHaveLength(0)
  })

  it('F-05: rời /links đóng ngay và không còn timer', async () => {
    vi.useFakeTimers()
    const { unmount, client } = renderApp('/links', handlers())
    await advance(50)
    await act(async () => sock().serverOpen())
    const s = sock()
    unmount()
    client.clear() // bỏ timer GC của TanStack Query; còn lại chỉ có thể là timer của hook
    expect(s.readyState).toBe(3)
    expect(s.closeCode).toBe(1000)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('F-06: pagehide đóng WebSocket', async () => {
    renderApp('/links', handlers())
    const s = await open()
    act(() => {
      window.dispatchEvent(new Event('pagehide'))
    })
    expect(s.readyState).toBe(3)
  })

  it('F-07: Tạm dừng đóng, nhớ qua tải lại; Tiếp tục mở lại', async () => {
    const first = renderApp('/links', handlers())
    const s = await open()
    fireEvent.click(screen.getByRole('button', { name: strings.livePauseButton }))
    expect(s.readyState).toBe(3)
    expect(localStorage.getItem(PAUSED_STORAGE_KEY)).toBe('1')
    const before = listCalls
    first.unmount()
    cleanup()
    FakeWebSocket.reset()

    renderApp('/links', handlers()) // "tải lại trang"
    await screen.findByText('5550001')
    expect(FakeWebSocket.instances).toHaveLength(0)
    expect(listCalls).toBe(before + 1) // chỉ lần tải trang, không poll
    fireEvent.click(screen.getByRole('button', { name: strings.liveResumeButton }))
    await waitFor(() => expect(FakeWebSocket.live).toHaveLength(1))
    expect(localStorage.getItem(PAUSED_STORAGE_KEY)).toBe('0')
  })

  it('F-08: localStorage ném lỗi vẫn chạy với Live bật và không hỏng khi tạm dừng', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    renderApp('/links', handlers())
    const s = await open()
    fireEvent.click(screen.getByRole('button', { name: strings.livePauseButton }))
    expect(s.readyState).toBe(3)
    expect(screen.getByRole('button', { name: strings.liveResumeButton })).toBeTruthy()
  })

  it('F-16: StrictMode mount hai lần, cuối cùng chỉ còn 1 WebSocket', async () => {
    renderApp('/links', handlers(), { strict: true })
    await screen.findByText('5550001')
    await act(async () => {})
    expect(FakeWebSocket.live).toHaveLength(1)
    expect(FakeWebSocket.maxLive).toBeLessThanOrEqual(1)
  })
})

describe('tab ẩn, không thao tác, nhịp tim (F-03, F-04, F-09, F-15)', () => {
  it('F-03: ẩn 10 giây mới đóng; hiện lại ở giây thứ 9 thì không đóng', async () => {
    vi.useFakeTimers()
    renderApp('/links', handlers())
    await advance(50)
    await act(async () => sock().serverOpen())
    const s = sock()

    setVisibility('hidden')
    await advance(9000)
    expect(s.readyState).toBe(1)
    setVisibility('visible')
    await advance(20_000)
    expect(s.readyState).toBe(1)

    setVisibility('hidden')
    await advance(9999)
    expect(s.readyState).toBe(1)
    await advance(2)
    expect(s.readyState).toBe(3)
    expect(FakeWebSocket.maxLive).toBeLessThanOrEqual(1)
  })

  it('F-04: hiện lại sau khi đã đóng => mở lại và làm mới danh sách đúng 1 lần', async () => {
    vi.useFakeTimers()
    renderApp('/links', handlers())
    await advance(50)
    await act(async () => sock().serverOpen())
    setVisibility('hidden')
    await advance(10_001)
    expect(FakeWebSocket.live).toHaveLength(0)
    const before = listCalls
    setVisibility('visible')
    await advance(10)
    expect(FakeWebSocket.live).toHaveLength(1)
    await act(async () => sock().serverOpen())
    await advance(50)
    expect(listCalls).toBe(before + 1)
  })

  it('F-09: không thao tác 10 phút tự tạm dừng; thao tác ở phút 9 đặt lại bộ đếm', async () => {
    vi.useFakeTimers()
    renderApp('/links', handlers())
    await advance(50)
    await act(async () => sock().serverOpen())
    const s = sock()
    await advance(9 * 60_000)
    act(() => {
      window.dispatchEvent(new Event('mousemove'))
    })
    await advance(9 * 60_000)
    expect(s.readyState).toBe(1)
    await advance(60_001)
    expect(s.readyState).toBe(3)
    expect(screen.getByText(strings.liveIdleBanner)).toBeTruthy()
    expect(localStorage.getItem(PAUSED_STORAGE_KEY)).toBeNull() // không lưu tạm dừng do idle
    fireEvent.click(screen.getByRole('button', { name: strings.liveResumeButton }))
    await advance(10)
    expect(FakeWebSocket.live).toHaveLength(1)
  })

  it('F-15: hb mỗi 25 giây, dừng khi đóng, không rò timer sau unmount', async () => {
    vi.useFakeTimers()
    const { unmount, client } = renderApp('/links', handlers())
    await advance(50)
    await act(async () => sock().serverOpen())
    const s = sock()
    const hbs = () => s.messages.filter((m) => (m as { t: string }).t === 'hb').length
    await advance(HEARTBEAT_MS)
    expect(hbs()).toBe(1)
    await advance(HEARTBEAT_MS)
    expect(hbs()).toBe(2)
    unmount()
    client.clear()
    await advance(HEARTBEAT_MS * 4)
    expect(hbs()).toBe(2)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('mất kết nối và kick (F-10, F-11, F-17, F-19)', () => {
  it('F-10: nối lại theo 1,2,4,8,16,30,30,30 giây; sau 8 lần hiện Thử lại', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0.5) // jitter = 1.0
    renderApp('/links', handlers())
    await advance(50)
    await act(async () => sock().serverOpen())
    await act(async () => sock().serverClose())
    let created = FakeWebSocket.instances.length
    for (const sec of BACKOFF_SECONDS) {
      await advance(sec * 1000 - 1)
      expect(FakeWebSocket.instances.length).toBe(created) // chưa tới giờ
      await advance(2)
      expect(FakeWebSocket.instances.length).toBe(created + 1)
      created += 1
      await act(async () => sock().serverClose()) // thử lại thất bại
    }
    expect(screen.getByText(strings.liveDisconnected)).toBeTruthy()
    await advance(5 * 60_000) // dưới ngưỡng idle 10 phút
    expect(FakeWebSocket.instances.length).toBe(created) // không nối nữa
    fireEvent.click(screen.getByRole('button', { name: strings.retry }))
    await advance(10)
    expect(FakeWebSocket.live).toHaveLength(1)
    expect(FakeWebSocket.maxLive).toBeLessThanOrEqual(1)
  })

  it('F-10: sự kiện online nối ngay và đặt lại backoff về 1 giây', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    renderApp('/links', handlers())
    await advance(50)
    await act(async () => sock().serverOpen())
    await act(async () => sock().serverClose())
    await advance(1001) // lần 1 (1 giây)
    await act(async () => sock().serverClose()) // chờ 2 giây cho lần 2
    const created = FakeWebSocket.instances.length
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(FakeWebSocket.instances.length).toBe(created + 1) // nối ngay, không chờ 2 giây
    expect(FakeWebSocket.live).toHaveLength(1)
    await act(async () => sock().serverClose())
    await advance(999)
    expect(FakeWebSocket.instances.length).toBe(created + 1)
    await advance(2) // backoff đã đặt lại: lần kế tiếp chờ 1 giây, không phải 4
    expect(FakeWebSocket.instances.length).toBe(created + 2)
    expect(FakeWebSocket.maxLive).toBeLessThanOrEqual(1)
  })

  it('F-11: kick too_many_tabs không tự nối lại và hiện thông báo', async () => {
    vi.useFakeTimers()
    renderApp('/links', handlers())
    await advance(50)
    await act(async () => sock().serverOpen())
    await act(async () => sock().serverSend({ t: 'kick', reason: 'too_many_tabs' }))
    expect(screen.getByText(strings.liveKickTabs)).toBeTruthy()
    await advance(5 * 60_000)
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(FakeWebSocket.live).toHaveLength(0)
  })

  it('F-11: kick session_expired không nối lại và kiểm tra lại phiên (401 -> đăng nhập)', async () => {
    let meCalls = 0
    renderApp('/links', {
      ...handlers(),
      'GET /api/me': () => {
        meCalls += 1
        return meCalls === 1
          ? json(200, me)
          : json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } })
      },
    })
    await screen.findByText('5550001')
    const s = await open()
    await act(async () => s.serverSend({ t: 'kick', reason: 'session_expired' }))
    await screen.findByText(strings.loginTitle, { selector: 'h2' })
    expect(FakeWebSocket.live).toHaveLength(0)
  })

  it('F-17: nối lại thay dữ liệu bằng snapshot mới, không trùng mẫu cũ', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    renderApp('/links', handlers())
    await advance(50)
    await act(async () => sock().serverOpen())
    await act(async () => sock().serverSend(snapshot('live', sample({ eq: 1111 }))))
    expect(screen.getByText('1,111.00 USD')).toBeTruthy()
    await act(async () => sock().serverClose())
    await advance(1001)
    await act(async () => sock().serverOpen())
    await act(async () => sock().serverSend(snapshot('live', sample({ eq: 2222 }))))
    expect(screen.getByText('2,222.00 USD')).toBeTruthy()
    expect(screen.queryByText('1,111.00 USD')).toBeNull()
  })
})

describe('dữ liệu live và hiển thị (F-12, F-13, F-14, F-18)', () => {
  it('F-12: samples cập nhật hàng, lãi/lỗ có dấu, không gọi lại D1', async () => {
    renderApp('/links', handlers())
    await screen.findByText('5550001')
    const s = await open()
    act(() => s.serverSend(samplesMsg()))
    expect(await screen.findByText('1,234.00 USD')).toBeTruthy()
    expect(screen.getByText('+55.50 USD')).toBeTruthy()
    expect(listCalls).toBe(1)
  })

  it('F-13: huy hiệu theo live_state: đánh thức, Live, không phản hồi', async () => {
    renderApp('/links', handlers())
    await screen.findByText('5550001')
    const s = await open()
    expect(screen.getByText(strings.badgeWaking)).toBeTruthy() // nối rồi mà chưa có tin
    act(() => s.serverSend({ t: 'live_state', id: 2, server_time: NOW, state: 'live' }))
    expect(screen.getByText(strings.badgeLive)).toBeTruthy()
    // Im lặng thoáng qua: vẫn giữ Live (ân hạn), không nhấp nháy sang "không phản hồi".
    act(() => s.serverSend({ t: 'live_state', id: 2, server_time: NOW, state: 'idle' }))
    expect(screen.getByText(strings.badgeLive)).toBeTruthy()
    expect(screen.queryByText(strings.badgeIdle)).toBeNull()
    // Im lặng liên tục quá ân hạn thì mới hiện "không phản hồi".
    const base = performance.now()
    const nowSpy = vi
      .spyOn(performance, 'now')
      .mockReturnValue(base + HEALTH_DOWNGRADE_GRACE_MS + 1000)
    try {
      await waitFor(() => expect(screen.getByText(strings.badgeIdle)).toBeTruthy(), {
        timeout: 3000,
      })
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('F-14: đang live thì cột "Nhận gần nhất" là huy hiệu Live cố định, đổi đồng hồ trình duyệt không làm nó đổi', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    renderApp('/links', handlers())
    await waitFor(() => expect(screen.getByText('5550001')).toBeTruthy())
    await waitFor(() => expect(FakeWebSocket.live).toHaveLength(1))
    await act(async () => sock().serverOpen())
    act(() => sock().serverSend(samplesMsg({ t: NOW - 5 })))
    const row = () => screen.getByText('5550001').closest('tr') as HTMLElement
    expect(row().textContent).toContain(strings.badgeLive)
    expect(row().textContent).not.toMatch(/vừa xong|giây trước/)
    vi.setSystemTime(Date.now() + 3_600_000)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1100)) // để useNow chạy lại
    })
    expect(row().textContent).toContain(strings.badgeLive)
    expect(row().textContent).not.toMatch(/vừa xong|giây trước/)
  })

  it('F-18: nút Live có aria-pressed; trạng thái đọc qua vùng aria-live', async () => {
    renderApp('/links', handlers())
    await screen.findByText('5550001')
    await open()
    const btn = screen.getByRole('button', { name: strings.livePauseButton })
    expect(btn.getAttribute('aria-pressed')).toBe('true')
    const status = screen
      .getAllByRole('status')
      .find((e) => e.getAttribute('aria-live') === 'polite')
    expect(status?.textContent).toBe(strings.liveWaking)
    fireEvent.click(btn)
    const resume = screen.getByRole('button', { name: strings.liveResumeButton })
    expect(resume.getAttribute('aria-pressed')).toBe('false')
    expect(status?.textContent).toBe(strings.livePaused)
  })
})
