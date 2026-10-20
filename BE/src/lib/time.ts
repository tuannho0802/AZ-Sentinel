export const M5_SECONDS = 300
const MAX_PAST_SECONDS = 7 * 24 * 3600

export function nowUnix(): number {
  return Math.floor(Date.now() / 1000)
}

/**
 * Thời điểm nến M5 cho equity_m5. Dùng ts_utc của EA (để gửi lại hàng đợi vẫn đúng nến)
 * nhưng chỉ khi nằm trong [now - 7 ngày, now + 1 nến]; ngoài khoảng đó coi là không tin
 * cậy và dùng giờ server (Rules BE mục 7).
 */
export function barTimestamp(tsUtc: number, now: number): number {
  const trusted = tsUtc >= now - MAX_PAST_SECONDS && tsUtc <= now + M5_SECONDS
  const base = trusted ? tsUtc : now
  return Math.floor(base / M5_SECONDS) * M5_SECONDS
}
