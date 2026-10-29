import type { MeResponse } from '@az-sentinel/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { cacheMe, readCachedMe } from './session-cache'

const me: MeResponse = { id: 7, email: 'a@b.vn', display_name: 'Admin', role: 'admin' }

afterEach(() => localStorage.clear())

describe('session-cache', () => {
  it('chưa có gì thì trả undefined (giao diện chờ /api/me như cũ)', () => {
    expect(readCachedMe()).toBeUndefined()
  })

  it('nhớ rồi đọc lại đúng người dùng', () => {
    cacheMe(me)
    expect(readCachedMe()).toEqual(me)
  })

  it('cacheMe(null) xóa (hết phiên hoặc đăng xuất)', () => {
    cacheMe(me)
    cacheMe(null)
    expect(readCachedMe()).toBeUndefined()
  })

  it('dữ liệu hỏng hoặc thiếu trường bị bỏ qua, không làm vỡ giao diện', () => {
    for (const bad of ['{', 'null', '[]', '{"id":"7"}', JSON.stringify({ id: 1, email: 'x' })]) {
      localStorage.setItem('az.me', bad)
      expect(readCachedMe(), bad).toBeUndefined()
    }
  })
})
