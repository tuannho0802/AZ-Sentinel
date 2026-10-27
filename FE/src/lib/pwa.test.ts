import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getInstallPrompt,
  hasManifest,
  installPageUrl,
  isIos,
  isStandalone,
  listenForInstallPrompt,
  promptInstall,
  registerServiceWorker,
} from './pwa'

const nav = (over: Record<string, unknown>) => over as unknown as Navigator

describe('isStandalone', () => {
  const win = (matches: boolean) => ({ matchMedia: () => ({ matches }) }) as unknown as Window

  it('nhận cửa sổ ứng dụng qua display-mode', () => {
    expect(isStandalone(win(true), nav({}))).toBe(true)
    expect(isStandalone(win(false), nav({}))).toBe(false)
  })
  it('nhận cả chế độ ứng dụng của iOS (navigator.standalone)', () => {
    expect(isStandalone(win(false), nav({ standalone: true }))).toBe(true)
  })
  it('môi trường không có matchMedia thì coi như không phải', () => {
    expect(isStandalone({} as Window, nav({}))).toBe(false)
  })
})

describe('isIos', () => {
  it('iPhone, iPad', () => {
    expect(isIos(nav({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' }))).toBe(true)
    expect(isIos(nav({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0)' }))).toBe(true)
  })
  it('iPadOS giả danh Mac nhưng có cảm ứng', () => {
    expect(isIos(nav({ userAgent: 'Mozilla/5.0 (Macintosh)', maxTouchPoints: 5 }))).toBe(true)
  })
  it('Mac thật và Android thì không', () => {
    expect(isIos(nav({ userAgent: 'Mozilla/5.0 (Macintosh)', maxTouchPoints: 0 }))).toBe(false)
    expect(isIos(nav({ userAgent: 'Mozilla/5.0 (Linux; Android 14)', maxTouchPoints: 5 }))).toBe(
      false,
    )
  })
})

describe('hasManifest', () => {
  afterEach(() => {
    document.head.innerHTML = ''
  })
  it('theo thẻ <link rel="manifest"> trong trang', () => {
    expect(hasManifest(document)).toBe(false)
    document.head.innerHTML = '<link rel="manifest" href="/manifest.webmanifest">'
    expect(hasManifest(document)).toBe(true)
  })
})

describe('installPageUrl', () => {
  it('trỏ về gốc Worker kèm tham số ở lại để Worker không chuyển hướng ngược về tunnel', () => {
    expect(
      installPageUrl('https://az.example.workers.dev/links?x=1', 'https://t1.trycloudflare.com'),
    ).toBe('https://az.example.workers.dev/?az_stay=1')
  })
  it('null khi chưa biết Worker, địa chỉ hỏng, giao thức lạ hoặc đang ở đúng Worker', () => {
    expect(installPageUrl(null, 'https://a')).toBeNull()
    expect(installPageUrl('', 'https://a')).toBeNull()
    expect(installPageUrl('not a url', 'https://a')).toBeNull()
    expect(installPageUrl('javascript:alert(1)', 'https://a')).toBeNull()
    expect(installPageUrl('https://w.dev', 'https://w.dev')).toBeNull()
  })
})

describe('registerServiceWorker', () => {
  const withManifest = () => {
    document.head.innerHTML = '<link rel="manifest" href="/manifest.webmanifest">'
  }
  afterEach(() => {
    document.head.innerHTML = ''
  })

  it('đăng ký /sw.js phạm vi gốc khi bật và có thẻ manifest', async () => {
    withManifest()
    const register = vi.fn(async () => ({}))
    const ok = await registerServiceWorker(nav({ serviceWorker: { register } }), document, true)
    expect(ok).toBe(true)
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' })
  })

  it('không đăng ký ở bản dev, trang không có manifest (tunnel/VPS) hoặc trình duyệt không hỗ trợ', async () => {
    const register = vi.fn(async () => ({}))
    const sw = nav({ serviceWorker: { register } })
    withManifest()
    expect(await registerServiceWorker(sw, document, false)).toBe(false)
    document.head.innerHTML = ''
    expect(await registerServiceWorker(sw, document, true)).toBe(false)
    withManifest()
    expect(await registerServiceWorker(nav({}), document, true)).toBe(false)
    expect(register).not.toHaveBeenCalled()
  })

  it('đăng ký lỗi thì không ném ra ngoài', async () => {
    withManifest()
    const register = vi.fn(async () => {
      throw new Error('blocked')
    })
    expect(await registerServiceWorker(nav({ serviceWorker: { register } }), document, true)).toBe(
      false,
    )
  })
})

describe('beforeinstallprompt', () => {
  it('giữ sự kiện, chặn banner mặc định, rồi bấm nút mới hiện hộp thoại một lần', async () => {
    const target = new EventTarget() as unknown as Window
    listenForInstallPrompt(target)
    const prompt = vi.fn(async () => {})
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt,
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    })
    target.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(getInstallPrompt()).toBe(event)

    expect(await promptInstall()).toBe('accepted')
    expect(prompt).toHaveBeenCalledTimes(1)
    // sự kiện chỉ dùng được một lần
    expect(getInstallPrompt()).toBeNull()
    expect(await promptInstall()).toBe('unavailable')
  })

  it('appinstalled xóa sự kiện còn giữ', () => {
    const target = new EventTarget() as unknown as Window
    listenForInstallPrompt(target)
    target.dispatchEvent(
      Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
        prompt: async () => {},
        userChoice: Promise.resolve({ outcome: 'dismissed' as const }),
      }),
    )
    expect(getInstallPrompt()).not.toBeNull()
    target.dispatchEvent(new Event('appinstalled'))
    expect(getInstallPrompt()).toBeNull()
  })
})
