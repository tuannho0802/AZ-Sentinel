const NOT_ALLOWED = /[^A-Za-z0-9._-]/g
export const VPS_LABEL_MAX = 32

/**
 * Chuẩn hóa nhãn VPS: cắt khoảng trắng, bỏ ký tự không cho phép,
 * viết hoa, tối đa 32 ký tự. Trả null nếu rỗng sau khi làm sạch.
 */
export function normalizeVpsLabel(input: string | null | undefined): string | null {
  if (!input) return null
  const cleaned = input.trim().replace(NOT_ALLOWED, '').toUpperCase().slice(0, VPS_LABEL_MAX)
  return cleaned.length > 0 ? cleaned : null
}
