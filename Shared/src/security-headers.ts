/**
 * Header bảo mật dùng chung cho BE (Worker), Server (VPS) và `FE/public/_headers`.
 * - `frame-ancestors 'none'` + `X-Frame-Options: DENY`: không cho nhúng iframe (chống clickjacking trên nút giao dịch).
 * - CSP của giao diện: chỉ script cùng origin (không inline). `connect-src` cho phép `https:`/`wss:` vì trang tự dò
 *   địa chỉ bản dự phòng (failover) ở origin khác; style cho phép inline vì React ghi thuộc tính `style`.
 * Khi sửa `UI_CSP` nhớ sửa luôn `FE/public/_headers` (có test canh lệch).
 */
export const UI_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' https: wss:",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

/** CSP cho phản hồi API (JSON): không có gì để tải, không được nhúng. */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'"

export const HSTS_VALUE = 'max-age=31536000'

const BASE: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
}

/**
 * Gắn header bảo mật vào `headers` (chỉ đặt khi chưa có, để route nào cần khác thì tự đặt trước).
 * `kind`: `api` cho đường `/api/*`, `ui` cho trang/tệp giao diện. HSTS chỉ khi request đi qua HTTPS.
 */
export function applySecurityHeaders(headers: Headers, kind: 'api' | 'ui', https: boolean): void {
  for (const [k, v] of Object.entries(BASE)) if (!headers.has(k)) headers.set(k, v)
  if (!headers.has('Content-Security-Policy')) {
    headers.set('Content-Security-Policy', kind === 'api' ? API_CSP : UI_CSP)
  }
  if (https && !headers.has('Strict-Transport-Security')) {
    headers.set('Strict-Transport-Security', HSTS_VALUE)
  }
}
