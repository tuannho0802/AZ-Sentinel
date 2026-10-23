import { act, cleanup, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetFailoverState, setNavigate } from '../../lib/failover'
import { recordNetworkError } from '../../lib/server-status'
import { strings } from '../../lib/strings'
import { json, me, renderApp } from '../../test/render-app'

/** Các phần tự động hóa phía giao diện chạy cùng nhau: chống vòng lặp, trang đăng nhập, phiên hết hạn đúng lúc VPS sập. */
const WORKER = 'https://az-api.acc.workers.dev'

const node = {
  role: 'vps',
  name: 'VPS',
  host: null,
  os: null,
  arch: null,
  runtime: 'node',
  version: '0.1.0',
  startedAt: 1,
  uptimeSec: 1,
  cpuCount: null,
  memTotalMb: null,
  memFreeMb: null,
  cpuPct: null,
  location: null,
}
const info = (extra: Record<string, unknown> = {}) => ({
  mode: 'primary',
  active: node,
  primary: { configured: true, status: 'up', lastSeenAt: 1, info: node },
  standby: null,
  gateways: 0,
  viewers: 0,
  checkedAt: 1,
  primaryUrl: null,
  fallbackUrl: WORKER,
  ...extra,
})

let vpsUp = true
const navigated: string[] = []
const down = () => {
  throw new TypeError('fetch failed')
}
const handlers = (serverInfo: () => unknown = () => info()) => ({
  'GET /api/me': () => json(200, me),
  'GET /api/links': () => json(200, { links: [] }),
  'GET /api/health': () => (vpsUp ? json(200, { status: 'ok' }) : down()),
  'GET /api/server-info': () => (vpsUp ? json(200, serverInfo()) : down()),
  [`GET ${WORKER}/api/health`]: () => new Response('{}'),
})
const sleep = (sec: number) => act(() => vi.advanceTimersByTimeAsync(sec * 1000))

beforeEach(() => {
  vpsUp = true
  navigated.length = 0
  localStorage.clear()
  resetFailoverState()
  setNavigate((url) => navigated.push(url))
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  setNavigate(null)
})

describe('chống vòng lặp chuyển trang', () => {
  it('đang ở CHÍNH địa chỉ dự phòng (Worker) mà mất kết nối: không tự chuyển, không đếm ngược', async () => {
    const here = window.location.origin
    const app = renderApp(
      '/',
      handlers(() => info({ fallbackUrl: here })),
    )
    await screen.findByRole('link', { name: strings.navOverview })
    await waitFor(() => expect(app.client.getQueryData(['server-info'])).toBeDefined())
    vpsUp = false
    await act(() => app.client.refetchQueries({ queryKey: ['server-info'] }))
    await screen.findByText(strings.lostBannerTitle)
    await sleep(30)
    expect(navigated).toEqual([])
    expect(screen.queryByText(/tự chuyển sang bản dự phòng sau/)).toBeNull()
  })

  it('không biết địa chỉ dự phòng nào: không chuyển đi đâu, banner bảo mở địa chỉ dự phòng thủ công', async () => {
    const app = renderApp(
      '/',
      handlers(() => info({ fallbackUrl: null })),
    )
    await screen.findByRole('link', { name: strings.navOverview })
    await waitFor(() => expect(app.client.getQueryData(['server-info'])).toBeDefined())
    vpsUp = false
    await act(() => app.client.refetchQueries({ queryKey: ['server-info'] }))
    await sleep(20)
    expect(navigated).toEqual([])
    expect(screen.getByText(strings.lostNoFallback)).toBeTruthy()
  })

  it('địa chỉ dự phòng lưu trong trình duyệt bị hỏng: bỏ qua, không văng lỗi, không chuyển', async () => {
    localStorage.setItem('az.fallbackUrl', 'javascript:alert(1)')
    const app = renderApp(
      '/',
      handlers(() => info({ fallbackUrl: null })),
    )
    await screen.findByRole('link', { name: strings.navOverview })
    await waitFor(() => expect(app.client.getQueryData(['server-info'])).toBeDefined())
    vpsUp = false
    await act(() => app.client.refetchQueries({ queryKey: ['server-info'] }))
    await sleep(20)
    expect(navigated).toEqual([])
  })
})

describe('các màn hình khác cùng cơ chế', () => {
  it('trang đăng nhập (chưa gọi được server-info): dùng địa chỉ dự phòng đã nhớ để chuyển', async () => {
    localStorage.setItem('az.fallbackUrl', WORKER)
    renderApp('/login', {
      ...handlers(),
      'GET /api/me': () => json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }),
    })
    await screen.findByLabelText(strings.email)
    vpsUp = false
    act(() => recordNetworkError())
    await sleep(10)
    expect(navigated).toEqual([`${WORKER}/`])
  })

  it('làm mới phiên thất bại đúng lúc VPS sập: giữ nguyên giao diện đang xem, không đá về màn lỗi', async () => {
    const app = renderApp('/', {
      ...handlers(),
      'GET /api/me': (() => {
        let n = 0
        return () => (++n === 1 ? json(200, me) : down())
      })(),
    })
    await screen.findByRole('link', { name: strings.navOverview })
    await act(() => app.client.refetchQueries({ queryKey: ['me'] }))
    expect(screen.queryByText(strings.sessionError)).toBeNull()
    expect(screen.getByRole('link', { name: strings.navOverview })).toBeTruthy()
  })

  it('VPS sập ngay lúc mở trang (chưa có phiên): thấy banner mất kết nối kèm nút thử lại', async () => {
    vpsUp = false
    renderApp('/', {
      ...handlers(),
      'GET /api/me': down,
    })
    await screen.findByText(strings.sessionError)
    await screen.findByText(strings.lostBannerTitle)
    expect(screen.getByRole('button', { name: strings.retry })).toBeTruthy()
  })
})

describe('chi phí request khi đang dự phòng', () => {
  it('server-info poll 10 giây khi dự phòng (thấy VPS lên lại sớm) và 30 giây khi bình thường', async () => {
    const count = (calls: unknown[][]) =>
      calls.filter((c) => String(c[0]) === '/api/server-info').length
    const fallback = renderApp(
      '/',
      handlers(() => info({ mode: 'fallback' })),
    )
    await screen.findByRole('link', { name: strings.navOverview })
    await waitFor(() => expect(count(fallback.fetchMock.mock.calls)).toBe(1))
    await sleep(11)
    expect(count(fallback.fetchMock.mock.calls)).toBeGreaterThanOrEqual(2)
    cleanup()

    const normal = renderApp('/', handlers())
    await screen.findByRole('link', { name: strings.navOverview })
    await waitFor(() => expect(count(normal.fetchMock.mock.calls)).toBe(1))
    await sleep(11)
    expect(count(normal.fetchMock.mock.calls)).toBe(1)
  })
})
