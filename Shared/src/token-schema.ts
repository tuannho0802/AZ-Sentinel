import { z } from 'zod'

/**
 * Token Gateway cấp riêng cho từng người (Plan 4). Một token gắn với đúng một người dùng; quản trị
 * viên cấp, đặt lại hoặc thu hồi. Token thô chỉ hiện MỘT lần (lúc cấp hoặc đặt lại).
 */
export const GW_TOKEN_PREFIX = 'azt_'
/** Độ dài token thô: `azt_` + 32 ký tự base64url. */
export const GW_TOKEN_LENGTH = 36
/** Số ký tự đầu lưu để nhận diện (gồm cả `azt_`). */
export const GW_TOKEN_SHOWN_PREFIX = 12

export const GW_TOKEN_STATUSES = ['active', 'revoked'] as const
export type GwTokenStatus = (typeof GW_TOKEN_STATUSES)[number]

/** Kiểm tra hình dạng token trước khi tra DB (request lạ không tốn truy vấn). */
export function looksLikeGwToken(value: string): boolean {
  return (
    value.startsWith(GW_TOKEN_PREFIX) &&
    value.length >= GW_TOKEN_PREFIX.length + 16 &&
    value.length <= 128 &&
    /^[A-Za-z0-9_-]+$/.test(value)
  )
}

export const createGwTokenRequestSchema = z.object({
  /** Người dùng nhận token (id người dùng). */
  owner_id: z.number().int().positive(),
  /** Tên hiển thị của người nhận. Bỏ trống thì BE lấy tên của người dùng (owner_id). */
  label: z.string().trim().min(1).max(64).optional(),
})
export type CreateGwTokenRequest = z.infer<typeof createGwTokenRequestSchema>

/** Một token trong danh sách: KHÔNG có token thô. */
export type GwTokenSummary = {
  id: number
  owner_id: number
  label: string
  prefix: string
  status: GwTokenStatus
  created_at: number
  last_used_at: number | null
  revoked_at: number | null
}

export type GwTokenListResponse = { tokens: GwTokenSummary[] }

/** Phản hồi cấp mới / đặt lại: `token` chỉ xuất hiện một lần. */
export type GwTokenSecretResponse = {
  token: string
  summary: GwTokenSummary
  /** Mã kết nối một dòng (`azc1.…`) gói sẵn địa chỉ + token; null nếu máy chủ chưa biết địa chỉ công khai của mình. */
  connect_code?: string | null
}

const hex64 = z.string().regex(/^[0-9a-f]{64}$/)

/** Dòng `gw_tokens` đồng bộ VPS -> Cloudflare (không gồm `last_used_at`: mỗi nơi tự ghi). */
export const syncTokenRowSchema = z.object({
  id: z.number().int().positive(),
  owner_id: z.number().int().positive(),
  label: z.string().max(64),
  token_hash: hex64,
  token_prefix: z.string().max(16),
  status: z.enum(GW_TOKEN_STATUSES),
  created_at: z.number().int(),
  revoked_at: z.number().int().nullable(),
})
export type SyncTokenRow = z.infer<typeof syncTokenRowSchema>
