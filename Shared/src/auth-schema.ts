import { z } from 'zod'

/** Vai trò và trạng thái User (Plan 2 mục 1 và 4). */
export const USER_ROLES = ['root_admin', 'admin', 'user'] as const
export type UserRole = (typeof USER_ROLES)[number]

export const USER_STATUSES = ['pending', 'active', 'rejected', 'suspended'] as const
export type UserStatus = (typeof USER_STATUSES)[number]

/**
 * Body POST /api/auth/login (Plan 2 mục 5). Cố ý KHÔNG áp độ dài tối thiểu cho mật khẩu:
 * quy tắc mật khẩu thuộc về đăng ký (Part 2); ở đây chỉ chặn rỗng và quá dài.
 */
export const loginRequestSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(128),
})
export type LoginRequest = z.infer<typeof loginRequestSchema>

/** Phản hồi của POST /api/auth/login và GET /api/me (hợp đồng FE giả định, BE làm ở Part 2). */
export type MeResponse = {
  id: number
  email: string
  display_name: string
  role: UserRole
}
