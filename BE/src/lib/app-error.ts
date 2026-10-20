import type { ApiErrorBody, ErrorCode } from '@az-sentinel/shared'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

/** Lỗi nghiệp vụ có mã HTTP và mã máy đọc; message dành cho người đọc. */
export class AppError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: ErrorCode,
    message: string,
    /** Có giá trị thì phản hồi kèm header `Retry-After` (giây), dùng cho 429. */
    readonly retryAfterSec?: number,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export function errorBody(code: ErrorCode, message: string): ApiErrorBody {
  return { error: { code, message } }
}
