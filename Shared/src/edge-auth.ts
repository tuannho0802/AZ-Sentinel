/**
 * Plan 3G: khi người dùng đi qua Worker (địa chỉ cố định) thì VPS chỉ thấy IP của Worker. Worker chuyển IP thật
 * bằng ba header dưới đây, kèm chữ ký HMAC-SHA256 (khóa = `SYNC_TOKEN`, bí mật chung của Worker và VPS) để
 * VPS chỉ tin IP do chính Worker của mình gửi, còn client tự đặt header này thì bị bỏ qua.
 */
export const EDGE_IP_HEADER = 'X-AZ-Client-IP'
export const EDGE_TS_HEADER = 'X-AZ-Edge-Ts'
export const EDGE_SIG_HEADER = 'X-AZ-Edge-Sig'

/** Chữ ký chỉ có hiệu lực trong khoảng lệch giờ này (giây) giữa Worker và VPS. */
export const EDGE_MAX_SKEW_SEC = 300

/** Chuỗi được ký: IP và mốc giờ (Unix giây), ngăn cách bằng `|`. */
export function edgeMessage(ip: string, ts: number): string {
  return `${ip}|${ts}`
}

/**
 * Chuẩn hóa địa chỉ tunnel VPS báo lên: chỉ nhận https, không đường dẫn, không tài khoản/cổng lạ, không IP
 * thô hay localhost. Sai định dạng trả null.
 */
export function normalizeTunnelOrigin(raw: string | null | undefined): string | null {
  const text = (raw ?? '').trim()
  if (text === '' || text.length > 256) return null
  try {
    const url = new URL(text)
    if (url.protocol !== 'https:') return null
    if (url.username !== '' || url.password !== '' || url.port !== '') return null
    const host = url.hostname.toLowerCase()
    if (host === 'localhost' || !host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':'))
      return null
    return url.origin
  } catch {
    return null
  }
}
