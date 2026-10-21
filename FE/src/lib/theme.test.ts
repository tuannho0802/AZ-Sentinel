import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyTheme, initTheme, readTheme, saveTheme, THEME_STORAGE_KEY } from './theme'

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

describe('theme', () => {
  it('mặc định theo máy khi chưa lưu hoặc giá trị lạ', () => {
    expect(readTheme()).toBe('system')
    localStorage.setItem(THEME_STORAGE_KEY, 'neon')
    expect(readTheme()).toBe('system')
  })

  it('đọc lại giá trị đã lưu', () => {
    saveTheme('dark')
    expect(readTheme()).toBe('dark')
    saveTheme('light')
    expect(readTheme()).toBe('light')
  })

  it('chọn "theo máy" thì xóa khóa đã lưu và gỡ data-theme', () => {
    saveTheme('dark')
    applyTheme('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    saveTheme('system')
    applyTheme('system')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('initTheme áp lựa chọn đã lưu', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light')
    initTheme()
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('localStorage hỏng: đọc về theo máy, ghi không văng lỗi', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(readTheme()).toBe('system')
    expect(() => saveTheme('dark')).not.toThrow()
  })
})
