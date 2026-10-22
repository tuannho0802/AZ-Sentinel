/**
 * Header nội bộ Worker -> hub đánh dấu kết nối của Gateway (Plan 3C). Route `/api/gw/ws` đặt nó;
 * route người xem xóa nó trước khi chuyển tiếp, nên trình duyệt không giả được. Hub chỉ nhận
 * được request qua binding nên không ai ngoài Worker gửi được.
 */
export const GW_HEADER = 'X-AZ-Gw'

/**
 * Header nội bộ Worker -> hub mang token đã xác thực của Gateway, dạng `<tokenId>.<ownerId>`. Route
 * `/api/gw/ws` luôn xóa giá trị do client gửi rồi mới đặt lại, nên không giả được.
 */
export const GW_TOKEN_HEADER = 'X-AZ-Gw-Token'

/** Mã đóng WebSocket hub gửi cho Gateway khi token của nó bị thu hồi hoặc đặt lại. */
export const GW_CLOSE_TOKEN_REVOKED = 4003

export function encodeGwToken(tokenId: number, ownerId: number): string {
  return `${tokenId}.${ownerId}`
}

export function decodeGwToken(raw: string | null): { tokenId: number; ownerId: number } | null {
  const m = /^(\d{1,15})\.(\d{1,15})$/.exec(raw ?? '')
  if (!m) return null
  const tokenId = Number(m[1])
  const ownerId = Number(m[2])
  return tokenId > 0 && ownerId > 0 ? { tokenId, ownerId } : null
}

/**
 * Mỗi kết nối Gateway giữ tối đa chừng này terminal. Danh sách terminal nằm trong storage của hub
 * (không còn nằm trong `serializeAttachment` 2 KB), nên giới hạn chỉ còn là chặn an toàn.
 */
export const MAX_GW_TERMS = 64
