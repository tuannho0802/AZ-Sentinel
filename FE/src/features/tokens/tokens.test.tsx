import type { GwTokenSummary } from '@az-sentinel/shared'
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
const active: GwTokenSummary = {
  id: 1,
  owner_id: 7,
  label: 'nguyen.van.a@az.local',
  prefix: 'azt_AbCd1234',
  status: 'active',
  created_at: NOW,
  last_used_at: null,
  revoked_at: null,
}
const revoked: GwTokenSummary = {
  ...active,
  id: 2,
  owner_id: 8,
  label: 'cu@az.local',
  prefix: 'azt_ZzZz9999',
  status: 'revoked',
  revoked_at: NOW,
}
const SECRET = 'azt_AbCd1234EfGh5678IjKl9012MnOp3456'

const base = {
  'GET /api/me': () => json(200, me),
  'GET /api/admin/gw-tokens': () => json(200, { tokens: [active, revoked] }),
}

describe('trang Token Gateway (admin)', () => {
  it('liệt kê token, không có token thô; token đã thu hồi không có nút thao tác', async () => {
    renderApp('/tokens', base)
    expect(await screen.findByText('nguyen.van.a@az.local')).toBeTruthy()
    expect(screen.getByText('azt_AbCd1234…')).toBeTruthy()
    expect(screen.getByText(strings.tokenNeverUsed)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: strings.tokenReset })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: strings.tokenRevoke })).toHaveLength(1)
  })

  it('cấp token: kiểm tra dữ liệu, gọi API, hiện token một lần và sao chép được', async () => {
    const issue = vi.fn(() =>
      json(201, { token: SECRET, summary: { ...active, id: 3, owner_id: 9, label: 'B' } }),
    )
    const writeText = vi.fn(async () => {})
    Object.assign(navigator, { clipboard: { writeText } })
    renderApp('/tokens', { ...base, 'POST /api/admin/gw-tokens': issue })

    fireEvent.click(await screen.findByRole('button', { name: strings.tokenIssue }))
    expect(await screen.findByText(strings.tokenOwnerInvalid)).toBeTruthy()
    fireEvent.change(screen.getByLabelText(strings.tokenOwnerId), { target: { value: '9' } })
    fireEvent.click(screen.getByRole('button', { name: strings.tokenIssue }))
    expect(await screen.findByText(strings.tokenLabelRequired)).toBeTruthy()
    expect(issue).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText(strings.tokenLabel), { target: { value: 'B' } })
    fireEvent.click(screen.getByRole('button', { name: strings.tokenIssue }))
    const dialog = await screen.findByRole('dialog')
    expect((within(dialog).getByLabelText(strings.tokenFieldLabel) as HTMLInputElement).value).toBe(
      SECRET,
    )
    fireEvent.click(within(dialog).getByRole('button', { name: strings.tokenCopy }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SECRET))
    fireEvent.click(within(dialog).getByRole('button', { name: strings.close }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.body.textContent).not.toContain(SECRET)
  })

  it('cấp trùng người dùng: báo đã có token đang hoạt động', async () => {
    renderApp('/tokens', {
      ...base,
      'POST /api/admin/gw-tokens': () =>
        json(409, { error: { code: 'CONFLICT', message: 'đã có' } }),
    })
    fireEvent.change(await screen.findByLabelText(strings.tokenOwnerId), { target: { value: '7' } })
    fireEvent.change(screen.getByLabelText(strings.tokenLabel), { target: { value: 'A' } })
    fireEvent.click(screen.getByRole('button', { name: strings.tokenIssue }))
    expect(await screen.findByText(strings.tokenIssueConflict)).toBeTruthy()
  })

  it('đặt lại: hỏi xác nhận rồi hiện token mới; huỷ xác nhận thì không gọi API', async () => {
    const reset = vi.fn(() => json(200, { token: SECRET, summary: active }))
    renderApp('/tokens', { ...base, 'POST /api/admin/gw-tokens/1/reset': reset })
    const btn = await screen.findByRole('button', { name: strings.tokenReset })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(btn)
    expect(confirm).toHaveBeenCalledWith(strings.tokenConfirmReset)
    expect(reset).not.toHaveBeenCalled()
    confirm.mockReturnValue(true)
    fireEvent.click(btn)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(strings.tokenDialogReset)).toBeTruthy()
  })

  it('thu hồi: hỏi xác nhận rồi gọi API', async () => {
    const revoke = vi.fn(() => json(200, { summary: revoked }))
    renderApp('/tokens', { ...base, 'POST /api/admin/gw-tokens/1/revoke': revoke })
    const btn = await screen.findByRole('button', { name: strings.tokenRevoke })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(btn)
    expect(confirm).toHaveBeenCalledWith(strings.tokenConfirmRevoke)
    await waitFor(() => expect(revoke).toHaveBeenCalledTimes(1))
  })

  it('không phải quản trị viên (403): báo không có quyền, không hiện form cấp token', async () => {
    renderApp('/tokens', {
      'GET /api/me': () => json(200, { ...me, role: 'user' }),
      'GET /api/admin/gw-tokens': () => json(403, { error: { code: 'FORBIDDEN', message: 'x' } }),
    })
    expect(await screen.findByText(strings.tokensForbidden)).toBeTruthy()
    expect(screen.queryByRole('button', { name: strings.tokenIssue })).toBeNull()
    expect(screen.queryByRole('link', { name: strings.navTokens })).toBeNull()
  })

  it('quản trị viên thấy mục menu Token Gateway; thao tác thất bại thì báo lỗi', async () => {
    renderApp('/tokens', {
      ...base,
      'POST /api/admin/gw-tokens/1/revoke': () =>
        json(500, { error: { code: 'INTERNAL', message: 'x' } }),
    })
    expect(await screen.findByRole('link', { name: strings.navTokens })).toBeTruthy()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(await screen.findByRole('button', { name: strings.tokenRevoke }))
    expect(await screen.findByText(strings.tokenActionFailed)).toBeTruthy()
  })

  it('danh sách rỗng: báo chưa cấp token nào, vẫn có form cấp', async () => {
    renderApp('/tokens', { ...base, 'GET /api/admin/gw-tokens': () => json(200, { tokens: [] }) })
    expect(await screen.findByText(strings.tokensEmpty)).toBeTruthy()
    expect(screen.getByRole('button', { name: strings.tokenIssue })).toBeTruthy()
  })

  it('lỗi tải danh sách (không phải 403): báo lỗi và có nút thử lại', async () => {
    renderApp('/tokens', {
      ...base,
      'GET /api/admin/gw-tokens': () => json(500, { error: { code: 'INTERNAL', message: 'x' } }),
    })
    expect(await screen.findByText(new RegExp(strings.tokensError))).toBeTruthy()
    expect(screen.getByRole('button', { name: strings.retry })).toBeTruthy()
  })

  it('cấp token lỗi khác 409: báo không cấp được', async () => {
    renderApp('/tokens', {
      ...base,
      'POST /api/admin/gw-tokens': () => json(500, { error: { code: 'INTERNAL', message: 'x' } }),
    })
    fireEvent.change(await screen.findByLabelText(strings.tokenOwnerId), { target: { value: '7' } })
    fireEvent.change(screen.getByLabelText(strings.tokenLabel), { target: { value: 'A' } })
    fireEvent.click(screen.getByRole('button', { name: strings.tokenIssue }))
    expect(await screen.findByText(strings.tokenIssueFailed)).toBeTruthy()
  })

  it('đặt lại thất bại thì không hiện hộp thoại token', async () => {
    renderApp('/tokens', {
      ...base,
      'POST /api/admin/gw-tokens/1/reset': () =>
        json(409, { error: { code: 'CONFLICT', message: 'x' } }),
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(await screen.findByRole('button', { name: strings.tokenReset }))
    expect(await screen.findByText(strings.tokenActionFailed)).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
