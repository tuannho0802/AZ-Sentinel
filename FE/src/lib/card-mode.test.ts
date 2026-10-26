import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CARD_MODE_STORAGE_KEY, DEFAULT_CARD_MODE, readCardMode, saveCardMode } from './card-mode'

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('kiểu thẻ điện thoại', () => {
  it('mặc định là thẻ gọn khi chưa chọn gì', () => {
    expect(DEFAULT_CARD_MODE).toBe('compact')
    expect(readCardMode()).toBe('compact')
  })

  it('nhớ lựa chọn của người dùng (cả hai chiều)', () => {
    saveCardMode('detailed')
    expect(localStorage.getItem(CARD_MODE_STORAGE_KEY)).toBe('detailed')
    expect(readCardMode()).toBe('detailed')
    saveCardMode('compact')
    expect(readCardMode()).toBe('compact')
  })

  it('giá trị lạ trong localStorage thì quay về thẻ gọn', () => {
    localStorage.setItem(CARD_MODE_STORAGE_KEY, '<script>')
    expect(readCardMode()).toBe('compact')
  })

  it('localStorage hỏng thì không văng lỗi', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(readCardMode()).toBe('compact')
    expect(() => saveCardMode('detailed')).not.toThrow()
  })
})
