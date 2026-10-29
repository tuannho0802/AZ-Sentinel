/**
 * Đo lượt mở trang để biết thời gian đi đâu (hiện ở thẻ "Máy chủ" trên Tổng quan). Mốc tính từ lúc bắt đầu điều
 * hướng, nên đã gồm cả chuỗi Service Worker, Worker, chuyển hướng sang tunnel, DNS/TLS.
 */
const marks: { script?: number; shown?: number; checked?: number } = {}
const now = () => Math.round(performance.now())

/** Gọi ở dòng đầu của `main.tsx`: lúc này gói JS đã tải xong và bắt đầu chạy. */
export function markScript(): void {
  marks.script ??= now()
}

/** Giao diện đã vượt qua cổng đăng nhập (vẽ được nội dung). */
export function markShown(): void {
  marks.shown ??= now()
}

/** `/api/me` đã trả lời (xác nhận phiên xong). */
export function markSessionChecked(): void {
  marks.checked ??= now()
}

export type LoadTiming = {
  html: number | null
  script: number | null
  shown: number | null
  checked: number | null
}

/** Mili giây kể từ lúc bắt đầu điều hướng. `html` = byte đầu tiên của trang (sau mọi chuyển hướng). */
export function loadTiming(): LoadTiming | null {
  try {
    const nav = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined
    if (!nav) return null
    return {
      html: nav.responseStart > 0 ? Math.round(nav.responseStart) : null,
      script: marks.script ?? null,
      shown: marks.shown ?? null,
      checked: marks.checked ?? null,
    }
  } catch {
    return null
  }
}

export const formatSec = (ms: number): string => `${(ms / 1000).toFixed(1)}s`
