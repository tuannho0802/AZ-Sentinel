import { SERVED_BY_HEADER, SERVER_MODE_HEADER } from '@az-sentinel/shared'
import { act, cleanup, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetFailoverState, setNavigate } from '../../lib/failover'
import { strings } from '../../lib/strings'
import { json, me, renderApp } from '../../test/render-app'

const WORKER = 'https://az-api.acc.workers.dev'
const TUNNEL = 'https://new-lake-222.trycloudflare.com'

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
let workerUp = true
const navigated: string[] = []

const handlers = () => ({
  'GET /api/me': () => json(200, me),
  'GET /api/links': () => json(200, { links: [] }),
  'GET /api/health': () => {
    if (!vpsUp) throw new TypeError('fetch failed')
    return json(200, { status: 'ok' })
  },
  'GET /api/server-info': () => {
    if (!vpsUp) throw new TypeError('fetch failed')
    return json(200, info())
  },
  [`GET ${WORKER}/api/health`]: () => {
    if (!workerUp) throw new TypeError('fetch failed')
    return new Response('{}')
  },
})

const sleep = (sec: number) => act(() => vi.advanceTimersByTimeAsync(sec * 1000))

beforeEach(() => {
  vpsUp = true
  workerUp = true
  navigated.length = 0
  localStorage.clear()
  resetFailoverState()
  setNavigate((url) => navigated.push(url))
  // Chỉ giả đồng hồ và interval; setTimeout thật để waitFor của testing-library vẫn chạy.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  setNavigate(null)
})

async function loadThenLoseVps() {
  const app = renderApp('/', handlers())
  await screen.findByRole('link', { name: strings.navOverview })
  await waitFor(() => expect(app.client.getQueryData(['server-info'])).toBeDefined())
  vpsUp = false
  await act(() => app.client.refetchQueries({ queryKey: ['server-info'] }))
  await screen.findByText(strings.lostBannerTitle)
  return app
}

describe('tự chuyển sang bản dự phòng khi VPS sập (Plan 3I)', () => {
  it('mất kết nối quá thời gian chờ: đếm ngược rồi chuyển, giữ nguyên trang đang xem', async () => {
    await loadThenLoseVps()
    expect(navigated).toEqual([])
    expect(screen.getByText(/tự chuyển sang bản dự phòng sau/)).toBeTruthy()
    await sleep(10)
    expect(navigated).toEqual([`${WORKER}/?az_stay=1`])
  })

  it('kết nối lại trước khi hết thời gian chờ (mạng chớp): không chuyển', async () => {
    await loadThenLoseVps()
    await sleep(4)
    vpsUp = true
    await sleep(15)
    expect(navigated).toEqual([])
    await waitFor(() => expect(screen.queryByText(strings.lostBannerTitle)).toBeNull())
  })

  it('bản dự phòng cũng chưa trả lời: không chuyển, báo rõ và vẫn dò tiếp; có rồi mới chuyển', async () => {
    workerUp = false
    await loadThenLoseVps()
    await sleep(15)
    expect(navigated).toEqual([])
    expect(screen.getByText(strings.lostFallbackDown)).toBeTruthy()
    workerUp = true
    await sleep(4)
    expect(navigated).toEqual([`${WORKER}/?az_stay=1`])
  })

  it('nhớ URL dự phòng trong trình duyệt để dùng khi chưa kịp gọi server-info', async () => {
    await loadThenLoseVps()
    expect(localStorage.getItem('az.fallbackUrl')).toBe(WORKER)
  })
})

describe('đang chạy dự phòng trên Cloudflare', () => {
  const headers = { [SERVED_BY_HEADER]: 'cloudflare', [SERVER_MODE_HEADER]: 'fallback' }

  it('VPS lên lại với tunnel mới: hiện nút mở thẳng địa chỉ mới, giữ trang đang xem', async () => {
    renderApp('/', {
      ...handlers(),
      'GET /api/server-info': () =>
        Response.json(info({ mode: 'fallback', primaryUrl: TUNNEL }), { headers }),
    })
    const link = await screen.findByRole('link', { name: strings.failoverBackToPrimary })
    expect(link.getAttribute('href')).toBe(`${TUNNEL}/`)
  })

  it('VPS còn sập: chưa hiện nút (địa chỉ cũ có thể đã chết)', async () => {
    renderApp('/', {
      ...handlers(),
      'GET /api/server-info': () =>
        Response.json(
          info({
            mode: 'fallback',
            primaryUrl: TUNNEL,
            primary: { configured: true, status: 'down', lastSeenAt: 1, info: null },
          }),
          { headers },
        ),
    })
    await screen.findByText(strings.failoverBannerTitle)
    expect(screen.queryByRole('link', { name: strings.failoverBackToPrimary })).toBeNull()
  })
})
