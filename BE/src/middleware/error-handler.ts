import type { ErrorCode } from '@az-sentinel/shared'
import type { Context, ErrorHandler, NotFoundHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { AppError, errorBody } from '../lib/app-error'
import { logJson } from '../lib/logger'
import type { AppEnv } from '../types'

function codeForStatus(status: number): ErrorCode {
  if (status === 400) return 'VALIDATION_FAILED'
  if (status === 401) return 'UNAUTHENTICATED'
  if (status === 403) return 'FORBIDDEN'
  if (status === 404) return 'NOT_FOUND'
  if (status === 413) return 'PAYLOAD_TOO_LARGE'
  if (status === 429) return 'RATE_LIMITED'
  return 'INTERNAL'
}

/** Bắt mọi lỗi, trả đúng dạng lỗi chuẩn, không lộ chi tiết nội bộ (Rules BE mục 9). */
export const onError: ErrorHandler<AppEnv> = (err, c) => {
  if (err instanceof AppError) {
    return c.json(errorBody(err.code, err.message), err.status)
  }
  if (err instanceof HTTPException && err.status >= 400 && err.status < 500) {
    const message = err.status === 400 ? 'Dữ liệu gửi lên không hợp lệ' : 'Yêu cầu không hợp lệ'
    return c.json(errorBody(codeForStatus(err.status), message), err.status as ContentfulStatusCode)
  }
  logJson('error', {
    requestId: c.get('requestId') ?? null,
    route: c.req.routePath,
    errorName: err.name,
    // message đã cắt ngắn; không bao giờ log body hay header.
    errorMessage: err.message.slice(0, 200),
  })
  return c.json(errorBody('INTERNAL', 'Lỗi hệ thống'), 500)
}

export const notFound: NotFoundHandler<AppEnv> = (c: Context<AppEnv>) =>
  c.json(errorBody('NOT_FOUND', 'Không tìm thấy'), 404)
