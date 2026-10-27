import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rememberFallbackUrl } from '../../lib/failover'
import { listenForInstallPrompt } from '../../lib/pwa'
import { strings } from '../../lib/strings'
import { InstallBanner } from './InstallBanner'

const MANIFEST = '<link rel="manifest" href="/manifest.webmanifest">'

function standalone(on: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: on && q.includes('standalone'),
    addEventListener() {},
    removeEventListener() {},
  }))
}

// một sự kiện cài đặt dùng chung (trình duyệt chỉ phát một lần mỗi trang)
const promptFn = vi.fn(async () => {})
function fireInstallPrompt() {
  window.dispatchEvent(
    Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: promptFn,
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    }),
  )
}

beforeEach(() => {
  localStorage.clear()
  document.head.innerHTML = ''
  standalone(false)
  promptFn.mockClear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

listenForInstallPrompt()

describe('InstallBanner', () => {
  it('trang VPS/tunnel (không có manifest) mà biết Worker: nút mở trang cài ở chế độ ở lại', () => {
    rememberFallbackUrl('https://az.example.workers.dev')
    render(<InstallBanner />)
    const link = screen.getByRole('link', { name: strings.installOpenWorker })
    expect(link.getAttribute('href')).toBe('https://az.example.workers.dev/?az_stay=1')
    expect(link.getAttribute('rel')).toContain('noopener')
  })

  it('trang VPS/tunnel mà chưa biết Worker: không hiện gì', () => {
    const { container } = render(<InstallBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('đã ở trong ứng dụng cài: không hiện', () => {
    standalone(true)
    rememberFallbackUrl('https://az.example.workers.dev')
    const { container } = render(<InstallBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('trang Worker (có manifest) và trình duyệt cho cài: nút Cài ứng dụng mở hộp thoại của trình duyệt', async () => {
    document.head.innerHTML = MANIFEST
    render(<InstallBanner />)
    expect(screen.queryByRole('button', { name: strings.installBtn })).toBeNull()
    act(() => fireInstallPrompt())
    fireEvent.click(await screen.findByRole('button', { name: strings.installBtn }))
    await vi.waitFor(() => expect(promptFn).toHaveBeenCalledTimes(1))
  })

  it('trang Worker mà trình duyệt chưa cho cài và không phải iOS: không hiện (không hứa điều không làm được)', () => {
    document.head.innerHTML = MANIFEST
    const { container } = render(<InstallBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('iOS Safari trên trang Worker: hướng dẫn Thêm vào Màn hình chính', () => {
    document.head.innerHTML = MANIFEST
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)',
      maxTouchPoints: 5,
    })
    render(<InstallBanner />)
    fireEvent.click(screen.getByRole('button', { name: strings.installBtn }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText(strings.installIosSteps)).toBeTruthy()
  })

  it('"Để sau" ẩn banner và nhớ trên thiết bị này', () => {
    rememberFallbackUrl('https://az.example.workers.dev')
    const first = render(<InstallBanner />)
    fireEvent.click(screen.getByRole('button', { name: strings.installLater }))
    expect(first.container.firstChild).toBeNull()
    first.unmount()
    const again = render(<InstallBanner />)
    expect(again.container.firstChild).toBeNull()
  })
})
