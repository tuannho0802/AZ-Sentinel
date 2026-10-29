/** Mã lỗi ổn định cho máy đọc (Rules BE mục 3). */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'INTERNAL',
  'SERVICE_UNAVAILABLE',
  'INVALID_API_KEY',
  'LINK_DISABLED',
  'LINK_LOCKED_BY_ADMIN',
  'LINK_BOUND_TO_OTHER_ACCOUNT',
  /** Plan 3E: VPS chính vừa mất kết nối giữa chừng, thao tác ghi không tự thử lại. */
  'UPSTREAM_FAILED',
  /** Plan 3E: đang chạy dự phòng Cloudflare, tạm chặn ghi liên kết. */
  'READ_ONLY_FALLBACK',
  /** v0.2.6: liên kết chưa bật giao dịch từ xa. */
  'TRADE_DISABLED',
  /** v0.2.6: lệnh trước của terminal chưa xong, hoặc terminal không sẵn sàng nhận lệnh. */
  'TRADE_BUSY',
] as const
export type ErrorCode = (typeof ERROR_CODES)[number]

export type ApiErrorBody = { error: { code: ErrorCode; message: string } }

export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null) return false
  const err = (value as { error?: unknown }).error
  if (typeof err !== 'object' || err === null) return false
  const e = err as { code?: unknown; message?: unknown }
  return typeof e.code === 'string' && typeof e.message === 'string'
}
