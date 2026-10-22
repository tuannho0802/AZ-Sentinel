import type { UserSummary } from '@az-sentinel/shared'
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
const mk = (id: number, name: string, over: Partial<UserSummary> = {}): UserSummary => ({
  id,
  email: `${name.toLowerCase()}@az.local`,
  display_name: name,
  role: 'user',
  status: 'active',
  created_at: NOW,
  has_token: false,
  ...over,
})

// `me` là admin id 1: dòng của chính mình không có nút khóa.
const list = [
  mk(1, 'Tuan', { role: 'admin' }),
  mk(2, 'An'),
  mk(3, 'Binh', { status: 'pending' }),
  mk(4, 'Cuong', { status: 'suspended' }),
]
const base = {
  'GET /api/me': () => json(200, me),
  'GET /api/admin/users': () => json(200, { users: list }),
}

// Tên người đăng nhập cũng hiện ở thanh đầu trang, nên chỉ tìm trong bảng.
const rowOf = (name: string) =>
  within(screen.getByRole('table')).getAllByText(name)[0]?.closest('tr') as HTMLElement

describe('trang Người dùng (admin)', () => {
  it('liệt kê người dùng và chỉ hiện nút phù hợp trạng thái', async () => {
    renderApp('/users', base)
    expect(await screen.findByRole('table')).toBeTruthy()
    expect(within(rowOf('An')).getByRole('button', { name: strings.userSuspend })).toBeTruthy()
    expect(within(rowOf('Binh')).getByRole('button', { name: strings.userApprove })).toBeTruthy()
    expect(
      within(rowOf('Cuong')).getByRole('button', { name: strings.userReactivate }),
    ).toBeTruthy()
    // Chính mình: không khóa được.
    expect(within(rowOf('Tuan')).queryByRole('button', { name: strings.userSuspend })).toBeNull()
  })

  it('admin thường không thấy lựa chọn vai trò quản trị khi thêm người dùng', async () => {
    renderApp('/users', base)
    await screen.findByRole('table')
    expect(screen.queryByLabelText(strings.userRole)).toBeNull()
  })

  it('thêm người dùng: kiểm tra dữ liệu rồi gọi API', async () => {
    const create = vi.fn(() => json(201, { user: mk(9, 'Moi') }))
    renderApp('/users', { ...base, 'POST /api/admin/users': create })
    await screen.findByRole('table')

    fireEvent.click(screen.getByRole('button', { name: strings.userCreate }))
    expect(await screen.findByText(strings.userEmailInvalid)).toBeTruthy()

    fireEvent.change(screen.getByLabelText(strings.userEmail), {
      target: { value: 'moi@az.local' },
    })
    fireEvent.change(screen.getByLabelText(strings.userDisplayName), { target: { value: 'Moi' } })
    fireEvent.change(screen.getByLabelText(strings.userPassword), { target: { value: 'ngan' } })
    fireEvent.click(screen.getByRole('button', { name: strings.userCreate }))
    expect(await screen.findByText(strings.userPasswordShort)).toBeTruthy()
    expect(create).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText(strings.userPassword), {
      target: { value: 'mat-khau-dai-123' },
    })
    fireEvent.click(screen.getByRole('button', { name: strings.userCreate }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
  })

  it('email trùng: hiện thông điệp của máy chủ', async () => {
    renderApp('/users', {
      ...base,
      'POST /api/admin/users': () =>
        json(409, { error: { code: 'CONFLICT', message: 'Email này đã được dùng' } }),
    })
    await screen.findByRole('table')
    fireEvent.change(screen.getByLabelText(strings.userEmail), { target: { value: 'an@az.local' } })
    fireEvent.change(screen.getByLabelText(strings.userDisplayName), { target: { value: 'An' } })
    fireEvent.change(screen.getByLabelText(strings.userPassword), {
      target: { value: 'mat-khau-dai-123' },
    })
    fireEvent.click(screen.getByRole('button', { name: strings.userCreate }))
    expect(await screen.findByText('Email này đã được dùng')).toBeTruthy()
  })

  it('khóa: hỏi xác nhận rồi gọi PATCH; huỷ thì không gọi', async () => {
    const patch = vi.fn(() => json(200, { user: mk(2, 'An', { status: 'suspended' }) }))
    renderApp('/users', { ...base, 'PATCH /api/admin/users/2': patch })
    const btn = within(rowOf(await screen.findByRole('table').then(() => 'An'))).getByRole(
      'button',
      {
        name: strings.userSuspend,
      },
    )
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(btn)
    expect(confirm).toHaveBeenCalledWith(strings.userConfirmSuspend)
    expect(patch).not.toHaveBeenCalled()
    confirm.mockReturnValue(true)
    fireEvent.click(btn)
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1))
  })

  it('đặt lại mật khẩu: kiểm tra độ dài trong hộp thoại rồi gọi PATCH', async () => {
    const patch = vi.fn(() => json(200, { user: mk(2, 'An') }))
    renderApp('/users', { ...base, 'PATCH /api/admin/users/2': patch })
    await screen.findByRole('table')
    fireEvent.click(within(rowOf('An')).getByRole('button', { name: strings.userResetPassword }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(strings.userPassword), {
      target: { value: 'ngan' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: strings.userPasswordSave }))
    expect(await within(dialog).findByText(strings.userPasswordShort)).toBeTruthy()
    expect(patch).not.toHaveBeenCalled()
    fireEvent.change(within(dialog).getByLabelText(strings.userPassword), {
      target: { value: 'mat-khau-moi-456' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: strings.userPasswordSave }))
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('người dùng thường vào trang: báo chỉ quản trị viên', async () => {
    renderApp('/users', {
      'GET /api/me': () => json(200, { ...me, role: 'user' }),
      'GET /api/admin/users': () =>
        json(403, { error: { code: 'FORBIDDEN', message: 'Chỉ quản trị viên' } }),
    })
    expect(await screen.findByText(strings.usersForbidden)).toBeTruthy()
  })
})
