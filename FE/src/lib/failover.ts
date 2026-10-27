import { PAGE_STAY_PARAM } from '@az-sentinel/shared'
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

/**
 * Thêm tham số "ở lại" vào địa chỉ bản dự phòng: Worker thường chuyển hướng trang về tunnel đang sống (Plan 3J), nhưng
 * kết quả dò tunnel được nhớ tạm vài giây nên ngay sau khi VPS sập nó có thể còn tưởng tunnel sống và đẩy ngược người
 * dùng về tunnel chết. Tham số này buộc Worker phục vụ giao diện dự phòng.
 */
export function stayOnFallback(target: string): string {
  const url = new URL(target)
  url.searchParams.set(PAGE_STAY_PARAM, '1')
  return url.toString()
}

/** Bỏ tham số "ở lại" khỏi thanh địa chỉ sau khi trang đã tải (Worker chỉ cần nó ở request đầu), để tải lại sau này vẫn tự về tunnel khi VPS sống. */
export function dropStayParam(
  loc: Location = window.location,
  hist: History = window.history,
): void {
  try {
    const url = new URL(loc.href)
    if (!url.searchParams.has(PAGE_STAY_PARAM)) return
    url.searchParams.delete(PAGE_STAY_PARAM)
    hist.replaceState(hist.state, '', `${url.pathname}${url.search}${url.hash}`)
  } catch {
    // môi trường không cho đổi lịch sử: bỏ qua
  }
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
