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
  'LINK_BOUND_TO_OTHER_ACCOUNT',
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
