/** Origin của dev server Vite; chỉ được thêm khi chạy cờ dev (DEV_LINKS_API=1). */
const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173']

function normalize(origin: string): string {
  return origin.trim().toLowerCase().replace(/\/+$/, '')
}

/**
 * Kiểm tra Origin của yêu cầu nâng cấp WebSocket (chống chiếm kết nối từ trang web lạ).
 * - Không có Origin: client không phải trình duyệt (trình duyệt luôn gửi); chấp nhận vì kẻ tấn
 *   công qua trình duyệt không thể bỏ header này. Vẫn phải qua xác thực phiên.
 * - Cùng host với yêu cầu: chấp nhận (cùng origin).
 * - Nằm trong danh sách cấu hình (`LIVE_ALLOWED_ORIGINS`) hoặc, ở dev, origin của Vite: chấp nhận.
 */
export function isOriginAllowed(input: {
  origin: string | undefined
  requestHost: string
  allowedCsv: string | undefined
  dev: boolean
}): boolean {
  const { origin, requestHost, allowedCsv, dev } = input
  if (origin === undefined || origin === '') return true
  let host: string
  try {
    host = new URL(origin).host
  } catch {
    return false
  }
  if (host === requestHost) return true
  const allowed = (allowedCsv ?? '')
    .split(',')
    .map(normalize)
    .filter((o) => o !== '')
  if (dev) allowed.push(...DEV_ORIGINS)
  return allowed.includes(normalize(origin))
}
