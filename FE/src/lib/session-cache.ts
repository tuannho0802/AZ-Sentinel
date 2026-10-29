import type { MeResponse } from '@az-sentinel/shared'

/**
 * Nhớ người dùng đã đăng nhập (chỉ thông tin hiển thị, KHÔNG phải chứng thực) để lần mở sau vẽ giao diện ngay
 * rồi mới xác nhận phiên ngầm với `/api/me`. Phân quyền thật vẫn ở BE; hết phiên thì `/api/me` trả 401, bộ nhớ
 * này bị xóa và giao diện chuyển về đăng nhập.
 */
const KEY = 'az.me'

export function readCachedMe(): MeResponse | undefined {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<MeResponse> | null
    if (
      v &&
      typeof v.id === 'number' &&
      typeof v.email === 'string' &&
      typeof v.display_name === 'string' &&
      typeof v.role === 'string'
    ) {
      return v as MeResponse
    }
  } catch {
    // trình duyệt chặn lưu trữ hoặc dữ liệu hỏng: coi như chưa có
  }
  return undefined
}

export function cacheMe(me: MeResponse | null): void {
  try {
    if (me) localStorage.setItem(KEY, JSON.stringify(me))
    else localStorage.removeItem(KEY)
  } catch {
    // bỏ qua
  }
}
