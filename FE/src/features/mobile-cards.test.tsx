import type { GwTokenSummary, UserSummary } from '@az-sentinel/shared'
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { strings } from '../lib/strings'
import { json, me, renderApp } from '../test/render-app'

/** Giả lập điện thoại: `(min-width: 48rem)` không khớp nên các trang vẽ thẻ thay vì bảng. */
function phone() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const NOW = Math.floor(Date.now() / 1000)
const token: GwTokenSummary = {
  id: 1,
  owner_id: 7,
  label: 'Tuan',
  prefix: 'azt_AbCd1234',
  status: 'active',
  created_at: NOW,
  last_used_at: null,
  revoked_at: null,
}
const person = (over: Partial<UserSummary> = {}): UserSummary => ({
  id: 5,
  email: 'an@az.local',
  display_name: 'An',
  role: 'user',
  status: 'pending',
  created_at: NOW,
  has_token: false,
  ...over,
})

describe('giao diện điện thoại: danh sách dạng thẻ', () => {
  it('Token Gateway: thẻ đủ thông tin, không còn bảng, nút thao tác dùng được', async () => {
    phone()
    renderApp('/tokens', {
      'GET /api/me': () => json(200, me),
      'GET /api/admin/gw-tokens': () => json(200, { tokens: [token] }),
      'GET /api/admin/users': () => json(200, { users: [] }),
    })
    const list = await screen.findByRole('list', { name: strings.tokensTitle })
    expect(screen.queryByRole('table')).toBeNull()
    const card = within(list).getByRole('listitem')
    expect(within(card).getByText('Tuan')).toBeTruthy()
    expect(within(card).getByText('azt_AbCd1234…')).toBeTruthy()
    expect(within(card).getByText(strings.tokenNeverUsed)).toBeTruthy()
    expect(within(card).getByRole('button', { name: strings.tokenRevoke })).toBeTruthy()
  })

  it('Người dùng: thẻ hiện vai trò, trạng thái và nút duyệt', async () => {
    phone()
    renderApp('/users', {
      'GET /api/me': () => json(200, me),
      'GET /api/admin/users': () => json(200, { users: [person()] }),
    })
    const list = await screen.findByRole('list', { name: strings.usersTitle })
    expect(screen.queryByRole('table')).toBeNull()
    const card = within(list).getByRole('listitem')
    expect(within(card).getByText('an@az.local')).toBeTruthy()
    expect(within(card).getByText(strings.userStatusPending)).toBeTruthy()
    expect(within(card).getByRole('button', { name: strings.userApprove })).toBeTruthy()
  })

  it('màn hình rộng vẫn là bảng (không đổi hành vi máy tính)', async () => {
    renderApp('/users', {
      'GET /api/me': () => json(200, me),
      'GET /api/admin/users': () => json(200, { users: [person()] }),
    })
    expect(await screen.findByRole('table')).toBeTruthy()
    expect(screen.queryByRole('list', { name: strings.usersTitle })).toBeNull()
  })

  it('thanh điều hướng có biểu tượng và vẫn là một nav duy nhất', async () => {
    phone()
    renderApp('/users', {
      'GET /api/me': () => json(200, me),
      'GET /api/admin/users': () => json(200, { users: [] }),
    })
    const nav = await screen.findByRole('navigation', { name: strings.mainNav })
    expect(within(nav).getAllByRole('link').length).toBeGreaterThanOrEqual(5)
    fireEvent.click(within(nav).getByRole('link', { name: strings.navTokens }))
  })
})
