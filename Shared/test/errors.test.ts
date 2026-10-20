import { describe, expect, it } from 'vitest'
import { isApiErrorBody } from '../src/errors'

describe('isApiErrorBody', () => {
  it('nhận dạng đúng dạng lỗi chuẩn', () => {
    expect(isApiErrorBody({ error: { code: 'FORBIDDEN', message: 'x' } })).toBe(true)
  })
  it('từ chối các dạng khác', () => {
    expect(isApiErrorBody(null)).toBe(false)
    expect(isApiErrorBody('lỗi')).toBe(false)
    expect(isApiErrorBody({ error: 'x' })).toBe(false)
    expect(isApiErrorBody({ error: { code: 1, message: 'x' } })).toBe(false)
  })
})
