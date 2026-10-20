import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { strings } from './lib/strings'
import { json, me, renderApp } from './test/render-app'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const unauth = () => json(401, { error: { code: 'UNAUTHENTICATED', message: 'Chưa đăng nhập' } })
const healthOk = () => json(200, { status: 'ok' })

function fill(email: string, password: string) {
  fireEvent.change(screen.getByLabelText(strings.email), { target: { value: email } })
  fireEvent.change(screen.getByLabelText(strings.password), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: strings.loginSubmit }))
}

describe('điều hướng và phiên', () => {
  it('chưa đăng nhập vào "/" thì chuyển tới form đăng nhập', async () => {
    renderApp('/', { 'GET /api/me': unauth })
    expect(await screen.findByRole('button', { name: strings.loginSubmit })).toBeTruthy()
  })

  it('đã đăng nhập vào "/" thì thấy tổng quan, tên người dùng và API OK', async () => {
    renderApp('/', { 'GET /api/me': () => json(200, me), 'GET /api/health': healthOk })
    expect(await screen.findByRole('heading', { name: strings.overviewTitle })).toBeTruthy()
    expect((await screen.findAllByText('Tuan')).length).toBeGreaterThan(0)
    expect(await screen.findByText(strings.apiOk)).toBeTruthy()
    expect(screen.getByRole('link', { name: strings.linksManage })).toBeTruthy()
  })

  it('đường dẫn lạ hiện trang không tìm thấy', async () => {
    renderApp('/abc', {})
    expect(await screen.findByText(strings.notFoundTitle)).toBeTruthy()
  })
})

describe('đăng nhập', () => {
  it('form rỗng: báo lỗi từng trường và không gọi API đăng nhập', async () => {
    const { fetchMock } = renderApp('/login', { 'GET /api/me': unauth })
    fireEvent.click(await screen.findByRole('button', { name: strings.loginSubmit }))
    expect(await screen.findByText(strings.emailInvalid)).toBeTruthy()
    expect(screen.getByText(strings.passwordRequired)).toBeTruthy()
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })

  it('đăng nhập đúng thì vào tổng quan', async () => {
    renderApp('/login', {
      'GET /api/me': unauth,
      'POST /api/auth/login': () => json(200, me),
      'GET /api/health': healthOk,
    })
    await screen.findByLabelText(strings.email)
    fill('a@az.local', 'mat-khau')
    expect(await screen.findByRole('heading', { name: strings.overviewTitle })).toBeTruthy()
  })

  it('sai mật khẩu (401) hiện thông điệp từ server', async () => {
    renderApp('/login', {
      'GET /api/me': unauth,
      'POST /api/auth/login': () =>
        json(401, {
          error: { code: 'UNAUTHENTICATED', message: 'Email hoặc mật khẩu không đúng' },
        }),
    })
    await screen.findByLabelText(strings.email)
    fill('a@az.local', 'sai')
    expect((await screen.findByRole('alert')).textContent).toBe('Email hoặc mật khẩu không đúng')
  })

  it('tài khoản chờ duyệt (403) hiện thông điệp từ server', async () => {
    renderApp('/login', {
      'GET /api/me': unauth,
      'POST /api/auth/login': () =>
        json(403, {
          error: { code: 'FORBIDDEN', message: 'Tài khoản đang chờ quản trị viên duyệt' },
        }),
    })
    await screen.findByLabelText(strings.email)
    fill('p@az.local', 'x')
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Tài khoản đang chờ quản trị viên duyệt',
    )
  })

  it('lỗi hệ thống (500) hiện thông điệp chung, không lộ chi tiết', async () => {
    renderApp('/login', {
      'GET /api/me': unauth,
      'POST /api/auth/login': () =>
        json(500, { error: { code: 'INTERNAL', message: 'chi tiết nội bộ' } }),
    })
    await screen.findByLabelText(strings.email)
    fill('a@az.local', 'x')
    expect((await screen.findByRole('alert')).textContent).toBe(strings.loginFailed)
  })
})

describe('tổng quan', () => {
  it('API lỗi: hiện lỗi và nút thử lại, bấm thì hồi phục', async () => {
    let healthy = false
    renderApp('/', {
      'GET /api/me': () => json(200, me),
      'GET /api/health': () =>
        healthy ? healthOk() : json(500, { error: { code: 'INTERNAL', message: 'Lỗi hệ thống' } }),
    })
    expect(await screen.findByText(strings.apiError)).toBeTruthy()
    healthy = true
    fireEvent.click(screen.getByRole('button', { name: strings.retry }))
    expect(await screen.findByText(strings.apiOk)).toBeTruthy()
  })

  it('đăng xuất thì quay về form đăng nhập', async () => {
    renderApp('/', {
      'GET /api/me': () => json(200, me),
      'GET /api/health': healthOk,
      'POST /api/auth/logout': () => json(200, { ok: true }),
    })
    fireEvent.click(await screen.findByRole('button', { name: strings.logout }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: strings.loginSubmit })).toBeTruthy(),
    )
  })
})
