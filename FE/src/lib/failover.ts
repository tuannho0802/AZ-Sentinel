import { useSyncExternalStore } from 'react'

/**
 * Tự chuyển sang bản dự phòng (Plan 3I). Trang đang mở từ VPS (địa chỉ tunnel) mà VPS sập hoặc tunnel đổi địa chỉ
 * thì không còn gì để gọi; trang tự dò lại vài giây, vẫn không được thì chuyển sang địa chỉ Worker dự phòng
 * (cùng bộ giao diện, cùng origin với API) để người dùng đăng nhập và xem tiếp.
 */

/** Dò lại chính máy chủ này mỗi nhịp; hồi phục tạm thời (mạng chớp) thì trạng thái tự về bình thường. */
export const PROBE_EVERY_SEC = 3
/** Mất kết nối liên tục từng này giây mới chuyển, tránh nhảy vì một lần mạng chớp. */
export const GRACE_SEC = 9

const STORAGE_KEY = 'az.fallbackUrl'

export type FailoverState = {
  /** Số giây còn lại trước khi chuyển; null = không đang đếm (còn kết nối, hoặc không biết bản dự phòng). */
  redirectInSec: number | null
  /** Đã có đích nhưng bản dự phòng chưa trả lời; trang vẫn dò tiếp. */
  fallbackDown: boolean
}

const IDLE: FailoverState = { redirectInSec: null, fallbackDown: false }
let state: FailoverState = IDLE
const listeners = new Set<() => void>()

export function setFailoverState(next: FailoverState): void {
  if (next.redirectInSec === state.redirectInSec && next.fallbackDown === state.fallbackDown) return
  state = next
  for (const l of listeners) l()
}

export const getFailoverState = (): FailoverState => state

export function useFailoverState(): FailoverState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    getFailoverState,
    getFailoverState,
  )
}

/** Chỉ để kiểm thử. */
export function resetFailoverState(): void {
  setFailoverState(IDLE)
}

/** Nhớ URL bản dự phòng để dùng được cả khi trang không gọi được `/api/server-info` (chưa đăng nhập, VPS đã sập). */
export function rememberFallbackUrl(url: string | null | undefined): void {
  try {
    if (url) localStorage.setItem(STORAGE_KEY, url)
  } catch {
    // trình duyệt chặn lưu trữ: bỏ qua, vẫn dùng được dữ liệu trong bộ nhớ
  }
}

export function readFallbackUrl(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

type Where = { origin: string; pathname: string; search: string }

/**
 * Địa chỉ đích khi chuyển sang dự phòng: giữ nguyên trang đang xem. Trả null khi không hợp lệ hoặc trùng chính
 * origin hiện tại (đang ở bản dự phòng rồi thì không chuyển, tránh vòng lặp).
 */
export function failoverTarget(fallbackUrl: string | null | undefined, here: Where): string | null {
  if (!fallbackUrl) return null
  let url: URL
  try {
    url = new URL(fallbackUrl)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.origin === here.origin) return null
  return `${url.origin}${here.pathname}${here.search}`
}

/** Địa chỉ máy chủ chính (tunnel) kèm trang đang xem; null khi trùng origin hiện tại hoặc không hợp lệ. */
export const primaryTarget = failoverTarget

/** Thay trang hiện tại bằng `url`. Tách riêng để test thay thế được. */
let navigate: (url: string) => void = (url) => window.location.replace(url)
export function setNavigate(fn: ((url: string) => void) | null): void {
  navigate = fn ?? ((url) => window.location.replace(url))
}
export function goTo(url: string): void {
  navigate(url)
}

/** Bản dự phòng có sống không? `no-cors` nên không cần CORS: chỉ cần kết nối được là fetch trả về (phản hồi đục). */
export async function isReachable(origin: string): Promise<boolean> {
  try {
    await fetch(`${origin}/api/health`, { mode: 'no-cors', cache: 'no-store' })
    return true
  } catch {
    return false
  }
}
