import type { ApiErrorBody, ErrorCode } from '@az-sentinel/shared'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

/** Lỗi nghiệp vụ có mã HTTP và mã máy đọc; message dành cho người đọc. */
export class AppError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export function errorBody(code: ErrorCode, message: string): ApiErrorBody {
  return { error: { code, message } }
}
