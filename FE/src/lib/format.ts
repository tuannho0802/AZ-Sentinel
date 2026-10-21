/** Định dạng thời gian và số tập trung một nơi (Rules FE mục 6). API trả Unix giây (UTC). */

export function formatDateTime(unix: number): string {
  return new Date(unix * 1000).toLocaleString('vi-VN')
}

/** Ngày rút gọn DD/MM/YY theo giờ máy người xem, ví dụ 21/10/26. */
export function formatDateShort(unix: number): string {
  const d = new Date(unix * 1000)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${two(d.getDate())}/${two(d.getMonth() + 1)}/${two(d.getFullYear() % 100)}`
}

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('vi-VN')
}

/** "vừa xong", "3 phút trước"... `nowMs` truyền vào để dễ kiểm thử. */
export function formatRelative(unix: number, nowMs: number = Date.now()): string {
  const diff = Math.max(0, Math.floor(nowMs / 1000) - unix)
  if (diff < 10) return 'vừa xong'
  if (diff < 60) return `${diff} giây trước`
  if (diff < 3600) return `${Math.floor(diff / 60)} phút trước`
  if (diff < 86400) return `${Math.floor(diff / 3600)} giờ trước`
  return `${Math.floor(diff / 86400)} ngày trước`
}

const numberFormat = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** Luôn kèm đơn vị tiền tệ của tài khoản; không có số liệu thì "—". */
export function formatMoney(value: number | null | undefined, currency: string | null): string {
  if (value === null || value === undefined) return '—'
  return currency ? `${numberFormat.format(value)} ${currency}` : numberFormat.format(value)
}

/** Lãi/lỗ có dấu +/− rõ ràng (không dựa vào màu duy nhất). */
export function formatSigned(value: number | null | undefined, currency: string | null): string {
  if (value === null || value === undefined) return '—'
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  const text = numberFormat.format(Math.abs(value))
  return currency ? `${sign}${text} ${currency}` : `${sign}${text}`
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return `${numberFormat.format(value)}%`
}
