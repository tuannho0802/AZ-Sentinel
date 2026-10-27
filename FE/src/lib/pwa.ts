import { useSyncExternalStore } from 'react'
import { stayOnFallback } from './failover'

/**
 * PWA (cài giao diện như một ứng dụng). Chỉ cài được từ địa chỉ Worker vì địa chỉ đó cố định: Worker chuyển hướng
 * lượt mở trang sang tunnel đang sống, còn ứng dụng cài từ địa chỉ tunnel sẽ chết ở lần tunnel đổi sau. Vì vậy
 * Server (VPS) gỡ thẻ manifest khỏi `index.html` (xem Server/src/static.ts) và giao diện coi "có thẻ manifest" là
 * "đang ở nơi cài được".
 */

/** Sự kiện `beforeinstallprompt` của Chromium (chưa có trong kiểu DOM chuẩn). */
export type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: InstallPromptEvent | null = null
const listeners = new Set<() => void>()
const notify = () => {
  for (const l of listeners) l()
}

/** Gọi một lần lúc khởi động: giữ lại sự kiện cài đặt để bấm nút mới hiện hộp thoại của trình duyệt. */
export function listenForInstallPrompt(target: Window = window): void {
  target.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as InstallPromptEvent
    notify()
  })
  target.addEventListener('appinstalled', () => {
    deferred = null
    notify()
  })
}

export const getInstallPrompt = (): InstallPromptEvent | null => deferred

export function useInstallPrompt(): InstallPromptEvent | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    getInstallPrompt,
    getInstallPrompt,
  )
}

/** Hiện hộp thoại cài của trình duyệt. Mỗi sự kiện chỉ dùng được một lần nên bỏ đi sau khi gọi. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferred
  if (!event) return 'unavailable'
  deferred = null
  notify()
  try {
    await event.prompt()
    return (await event.userChoice).outcome
  } catch {
    return 'dismissed'
  }
}

/** Đang chạy trong cửa sổ ứng dụng đã cài (không còn thanh địa chỉ). */
export function isStandalone(
  win: Window = window,
  nav: Navigator & { standalone?: boolean } = navigator,
): boolean {
  try {
    return win.matchMedia('(display-mode: standalone)').matches || nav.standalone === true
  } catch {
    return false
  }
}

/** iPhone/iPad (kể cả iPadOS giả danh Mac): Safari không có `beforeinstallprompt`, phải hướng dẫn tay. */
export function isIos(nav: Navigator = navigator): boolean {
  const ua = nav.userAgent ?? ''
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && nav.maxTouchPoints > 1)
}

/** Trang này có khai báo manifest = do Worker phục vụ = nơi cài được. */
export function hasManifest(doc: Document = document): boolean {
  return doc.querySelector('link[rel="manifest"]') !== null
}

/**
 * Địa chỉ Worker để mở và cài ứng dụng: trang gốc kèm tham số "ở lại" để Worker phục vụ giao diện thay vì chuyển
 * hướng lại về tunnel (nơi không cài được). Null khi không biết Worker hoặc đã đang ở đúng origin đó.
 */
export function installPageUrl(
  fallbackUrl: string | null | undefined,
  hereOrigin: string,
): string | null {
  if (!fallbackUrl) return null
  let url: URL
  try {
    url = new URL(fallbackUrl)
  } catch {
    return null
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.origin === hereOrigin) {
    return null
  }
  return stayOnFallback(`${url.origin}/`)
}

/**
 * Đăng ký service worker (chỉ lo trang "mất mạng"). Chỉ chạy ở bản build và chỉ khi trang có thẻ manifest, tức là
 * không đăng ký trên địa chỉ tunnel/VPS, nơi nó vô nghĩa và sẽ mồ côi khi tunnel đổi.
 */
export async function registerServiceWorker(
  nav: Navigator = navigator,
  doc: Document = document,
  enabled: boolean = import.meta.env.PROD,
): Promise<boolean> {
  if (!enabled || !('serviceWorker' in nav) || !hasManifest(doc)) return false
  try {
    await nav.serviceWorker.register('/sw.js', { scope: '/' })
    return true
  } catch {
    return false
  }
}
