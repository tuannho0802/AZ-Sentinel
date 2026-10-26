import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { strings } from '../../lib/strings'
import { json, me, renderApp } from '../../test/render-app'

const node = {
  role: 'vps',
  name: 'VPS',
  host: null,
  os: null,
  arch: null,
  runtime: 'node',
  version: '0.2.3',
  startedAt: 1,
  uptimeSec: 1,
  cpuCount: null,
  memTotalMb: null,
  memFreeMb: null,
  cpuPct: null,
  location: null,
}

const RELEASE_URL = 'https://github.com/tuannho0802/AZ-Sentinel/releases/tag/server-v0.3.0'

const info = (update?: unknown) => ({
  mode: 'primary',
  active: node,
  primary: { configured: true, status: 'up', lastSeenAt: 1, info: node },
  standby: null,
  gateways: 0,
  viewers: 0,
  checkedAt: 1,
  ...(update === undefined ? {} : { update }),
})

const available = (latest = '0.3.0', url = RELEASE_URL) => ({
  server: { latest, url, available: true },
  checkedAt: 1_700_000_000,
})

function open(opts: { update?: unknown; role?: string } = {}) {
  return renderApp('/', {
    'GET /api/me': () => json(200, { ...me, role: opts.role ?? 'admin' }),
    'GET /api/links': () => json(200, { links: [] }),
    'GET /api/server-info': () => json(200, info(opts.update)),
  })
}

const waitForShell = () => screen.findByRole('link', { name: strings.navOverview })
const title = (v = '0.3.0') => strings.updateBannerTitle(v)

beforeEach(() => localStorage.clear())
afterEach(() => cleanup())

describe('banner có bản AZ Server mới', () => {
  it('admin thấy banner có phiên bản và liên kết tải về github.com', async () => {
    open({ update: available() })
    expect(await screen.findByText(title())).toBeTruthy()
    const link = screen.getByRole('link', { name: strings.updateBannerGet })
    expect(link.getAttribute('href')).toBe(RELEASE_URL)
    expect(link.getAttribute('rel')).toContain('noopener')
  })

  it('người dùng thường không thấy (không phải người cập nhật Server)', async () => {
    open({ update: available(), role: 'user' })
    await waitForShell()
    await waitFor(() => expect(screen.queryByText(title())).toBeNull())
  })

  it('đang là bản mới nhất thì không hiện', async () => {
    open({
      update: { server: { latest: '0.2.3', url: RELEASE_URL, available: false }, checkedAt: 1 },
    })
    await waitForShell()
    expect(screen.queryByText(/Có bản AZ Server mới/)).toBeNull()
  })

  it('giao diện qua Worker (phản hồi không có trường update) thì không hiện', async () => {
    open()
    await waitForShell()
    expect(screen.queryByText(/Có bản AZ Server mới/)).toBeNull()
  })

  it('chưa kiểm tra được (server: null) thì không hiện', async () => {
    open({ update: { server: null, checkedAt: null } })
    await waitForShell()
    expect(screen.queryByText(/Có bản AZ Server mới/)).toBeNull()
  })

  it('"Để sau" ẩn đúng phiên bản đó và nhớ lại; bản mới hơn thì hiện lại', async () => {
    const first = open({ update: available('0.3.0') })
    fireEvent.click(await screen.findByRole('button', { name: strings.updateBannerLater }))
    expect(screen.queryByText(title('0.3.0'))).toBeNull()
    expect(localStorage.getItem('az.updateDismissed')).toBe('0.3.0')
    first.unmount()
    cleanup()

    open({ update: available('0.3.0') })
    await waitForShell()
    expect(screen.queryByText(title('0.3.0'))).toBeNull()
    cleanup()

    open({
      update: available(
        '0.4.0',
        'https://github.com/tuannho0802/AZ-Sentinel/releases/tag/server-v0.4.0',
      ),
    })
    expect(await screen.findByText(title('0.4.0'))).toBeTruthy()
  })

  it('địa chỉ không phải github.com thì không đưa vào liên kết', async () => {
    open({ update: available('0.3.0', 'javascript:alert(1)') })
    expect(await screen.findByText(title())).toBeTruthy()
    expect(screen.queryByRole('link', { name: strings.updateBannerGet })).toBeNull()
  })
})
