import { describe, expect, it } from 'vitest'
import { loginRequestSchema } from '../src'

describe('loginRequestSchema', () => {
  it('chấp nhận email và mật khẩu hợp lệ', () => {
    expect(loginRequestSchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true)
  })

  it.each(['', 'khong-phai-email', 'a@', `${'a'.repeat(250)}@b.co`])(
    'từ chối email không hợp lệ %j',
    (email) => {
      expect(loginRequestSchema.safeParse({ email, password: 'x' }).success).toBe(false)
    },
  )

  it('từ chối mật khẩu rỗng hoặc quá 128 ký tự', () => {
    expect(loginRequestSchema.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false)
    expect(
      loginRequestSchema.safeParse({ email: 'a@b.co', password: 'x'.repeat(129) }).success,
    ).toBe(false)
  })

  it('không áp độ dài tối thiểu cho mật khẩu khi đăng nhập', () => {
    expect(loginRequestSchema.safeParse({ email: 'a@b.co', password: '1' }).success).toBe(true)
  })
})
