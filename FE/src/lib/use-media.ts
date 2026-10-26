import { useSyncExternalStore } from 'react'

/**
 * Theo dõi một media query. Trả về `fallback` khi môi trường không có `matchMedia` (jsdom, SSR) để
 * test và lần vẽ đầu luôn có kết quả xác định. Dùng để chỉ vẽ MỘT trong hai bố cục (bảng / thẻ)
 * thay vì vẽ cả hai rồi ẩn bằng CSS, nên không bị trùng nhãn, trùng ô nhập trong DOM.
 */
export function useMedia(query: string, fallback: boolean): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {}
      const mq = window.matchMedia(query)
      mq.addEventListener('change', notify)
      return () => mq.removeEventListener('change', notify)
    },
    () =>
      typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia(query).matches
        : fallback,
    () => fallback,
  )
}

/** Từ 768px trở lên (khớp breakpoint `md` của Tailwind) hiện bảng; nhỏ hơn hiện thẻ. */
export function useIsWide(): boolean {
  return useMedia('(min-width: 48rem)', true)
}
