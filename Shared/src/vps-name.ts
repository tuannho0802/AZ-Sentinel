import { z } from 'zod'

/** Độ dài tối đa tên VPS do người dùng nhập. */
export const VPS_NAME_MAX = 40

// Ký tự điều khiển (xuống dòng, tab, ...) không có chỗ trong một cái tên.
// biome-ignore lint/suspicious/noControlCharactersInRegex: chủ ý loại ký tự điều khiển
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g

/**
 * Chuẩn hóa tên VPS người dùng nhập: bỏ ký tự điều khiển, gộp khoảng trắng liên tiếp, cắt hai đầu,
 * tối đa `VPS_NAME_MAX` ký tự. Giữ nguyên chữ hoa/thường và dấu tiếng Việt (đây là nhãn cho người
 * đọc, khác `normalizeVpsLabel` của Gateway). Rỗng sau khi làm sạch thì trả null (= chưa đặt tên).
 */
export function normalizeVpsName(input: string | null | undefined): string | null {
  if (!input) return null
  const cleaned = input.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim()
  const cut = Array.from(cleaned).slice(0, VPS_NAME_MAX).join('').trim()
  return cut.length > 0 ? cut : null
}

/** Thân yêu cầu đặt/đổi tên VPS. `null` hoặc rỗng = xóa tên. Giới hạn thô; server chuẩn hóa tiếp. */
export const setVpsNameSchema = z.object({
  vps_name: z.string().max(200).nullable(),
})

/** Thân yêu cầu tạo liên kết: tên VPS là tùy chọn. */
export const createLinkRequestSchema = z.object({
  vps_name: z.string().max(200).nullable().optional(),
})
export type CreateLinkRequest = z.infer<typeof createLinkRequestSchema>
