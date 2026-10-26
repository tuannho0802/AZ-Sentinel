import { useCallback, useState } from 'react'

/**
 * Kiểu thẻ của danh sách Liên kết EA trên điện thoại: `compact` (mặc định, xem nhanh nhiều tài khoản trong một lần
 * vuốt) hoặc `detailed` (đủ thông tin và nút thao tác). Lựa chọn nhớ ở localStorage (chỉ là sở thích, không nhạy cảm).
 */
export type CardMode = 'compact' | 'detailed'

export const CARD_MODE_STORAGE_KEY = 'az.links.cardMode'
export const DEFAULT_CARD_MODE: CardMode = 'compact'

function isMode(v: unknown): v is CardMode {
  return v === 'compact' || v === 'detailed'
}

export function readCardMode(): CardMode {
  try {
    const v = localStorage.getItem(CARD_MODE_STORAGE_KEY)
    return isMode(v) ? v : DEFAULT_CARD_MODE
  } catch {
    return DEFAULT_CARD_MODE // localStorage hỏng thì dùng thẻ gọn, không làm hỏng trang
  }
}

export function saveCardMode(mode: CardMode): void {
  try {
    localStorage.setItem(CARD_MODE_STORAGE_KEY, mode)
  } catch {
    // bỏ qua: chỉ mất khả năng nhớ lựa chọn
  }
}

/** Kiểu thẻ hiện tại và hàm đổi (đổi xong nhớ luôn). Đọc đồng bộ nên lần vẽ đầu đã đúng kiểu, không nháy. */
export function useCardMode(): [CardMode, (mode: CardMode) => void] {
  const [mode, setMode] = useState<CardMode>(readCardMode)
  const change = useCallback((next: CardMode) => {
    setMode(next)
    saveCardMode(next)
  }, [])
  return [mode, change]
}
