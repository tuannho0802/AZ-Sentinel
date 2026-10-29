import type { Context } from 'hono'
import type { AppEnv } from '../types'
import { AppError } from './app-error'
import { sha256Hex } from './crypto'

/**
 * Xác thực bí mật dịch vụ bằng `Authorization: Bearer <token>`. So sánh qua băm SHA-256 để không lộ
 * độ dài hay vị trí lệch. Chưa cấu hình thì chỉ cho qua khi chạy dev (`DEV_LINKS_API=1`), còn lại 503
 * (an toàn mặc định).
 */
export async function requireServiceToken(
  c: Context<AppEnv>,
  expected: string | undefined,
  messages: { missing: string; invalid: string },
): Promise<void> {
  if (!expected) {
    if (c.env.DEV_LINKS_API === '1') return
    throw new AppError(503, 'SERVICE_UNAVAILABLE', messages.missing)
  }
  const given = bearerToken(c.req.header('Authorization'))
  const [a, b] = await Promise.all([sha256Hex(given), sha256Hex(expected)])
  if (a !== b) throw new AppError(401, 'UNAUTHENTICATED', messages.invalid)
}

/**
 * Lấy token từ `Authorization: Bearer <token>`. Tên scheme không phân biệt hoa thường (RFC 7235 mục 2.1),
 * nên `bearer`/`BEARER` cũng hợp lệ; thiếu hoặc sai scheme trả chuỗi rỗng.
 */
export function bearerToken(header: string | null | undefined): string {
  const m = /^Bearer[ \t]+(\S.*)$/i.exec((header ?? '').trim())
  return m?.[1]?.trim() ?? ''
}
