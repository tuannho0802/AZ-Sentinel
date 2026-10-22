import { z } from 'zod'
import { USER_ROLES, USER_STATUSES } from './auth-schema'

/**
 * Quản lý người dùng (Plan 4B). Quản trị viên tạo tài khoản; người dùng đăng nhập bằng email và mật
 * khẩu. Mật khẩu chỉ đi một chiều (client -> BE), không bao giờ có trong phản hồi.
 */
export const PASSWORD_MIN_LENGTH = 10
export const PASSWORD_MAX_LENGTH = 128

const email = z
  .email()
  .max(254)
  .transform((v) => v.trim().toLowerCase())
const displayName = z.string().trim().min(1).max(64)
const password = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH)

/** Vai trò được phép gán khi tạo/sửa qua API (`root_admin` chỉ tạo bằng dòng lệnh trên VPS). */
export const ASSIGNABLE_ROLES = [
  'admin',
  'user',
] as const satisfies readonly (typeof USER_ROLES)[number][]

export const createUserRequestSchema = z.object({
  email,
  display_name: displayName,
  password,
  role: z.enum(ASSIGNABLE_ROLES).default('user'),
})
export type CreateUserRequest = z.input<typeof createUserRequestSchema>

export const updateUserRequestSchema = z
  .object({
    display_name: displayName,
    role: z.enum(ASSIGNABLE_ROLES),
    status: z.enum(USER_STATUSES),
    password,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Cần ít nhất một trường để sửa' })
export type UpdateUserRequest = z.input<typeof updateUserRequestSchema>

/** Một người dùng trong danh sách. `has_token` = đang có token Gateway hoạt động. */
export type UserSummary = {
  id: number
  email: string
  display_name: string
  role: (typeof USER_ROLES)[number]
  status: (typeof USER_STATUSES)[number]
  created_at: number
  has_token: boolean
}

export type UserListResponse = { users: UserSummary[] }
export type UserResponse = { user: UserSummary }
/**
 * Dòng `users` đồng bộ VPS -> Cloudflare để bản dự phòng đăng nhập được khi VPS sập. Mang theo băm mật
 * khẩu (PBKDF2, không phải mật khẩu thô); KHÔNG gồm `failed_logins`/`locked_until` (mỗi nơi tự đếm).
 * VPS là nguồn gốc duy nhất của người dùng: chỉ đẩy một chiều.
 */
export const syncUserRowSchema = z.object({
  id: z.number().int().positive(),
  email: z.string().min(3).max(254),
  display_name: z.string().min(1).max(64),
  password_hash: z.string().min(1).max(512),
  role: z.enum(USER_ROLES),
  status: z.enum(USER_STATUSES),
  created_at: z.number().int(),
})
export type SyncUserRow = z.infer<typeof syncUserRowSchema>
