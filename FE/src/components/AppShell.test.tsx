import { cleanup, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { strings } from '../lib/strings'
import { json, me, renderApp } from '../test/render-app'

afterEach(cleanup)

const handlers = {
  'GET /api/me': () => json(200, me),
  'GET /api/health': () => json(200, { status: 'ok' }),
  'GET /api/links': () => json(200, { links: [] }),
}

describe('AppShell', () => {
  it('có liên kết "bỏ qua điều hướng" trỏ tới nội dung chính', async () => {
    renderApp('/', handlers)
    const skip = await screen.findByText(strings.skipToContent)
    expect(skip.getAttribute('href')).toBe('#main')
    expect(document.getElementById('main')).not.toBeNull()
  })

  it('menu chính có nhãn và đánh dấu trang hiện tại bằng aria-current', async () => {
    renderApp('/', handlers)
    const nav = await screen.findByRole('navigation', { name: strings.mainNav })
    const overview = await screen.findByRole('link', { name: strings.navOverview })
    expect(nav.contains(overview)).toBe(true)
    expect(overview.getAttribute('aria-current')).toBe('page')
    expect(
      screen.getByRole('link', { name: strings.navLinks }).getAttribute('aria-current'),
    ).toBeNull()
  })

  it('ở trang Liên kết EA thì mục đó là trang hiện tại', async () => {
    renderApp('/links', handlers)
    const links = await screen.findByRole('link', { name: strings.navLinks })
    expect(links.getAttribute('aria-current')).toBe('page')
    expect(
      screen.getByRole('link', { name: strings.navOverview }).getAttribute('aria-current'),
    ).toBeNull()
  })

  it('có nút đổi giao diện và nút đăng xuất', async () => {
    renderApp('/', handlers)
    expect(await screen.findByRole('button', { name: new RegExp(strings.themeLabel) })).toBeTruthy()
    expect(screen.getByRole('button', { name: strings.logout })).toBeTruthy()
  })
})
