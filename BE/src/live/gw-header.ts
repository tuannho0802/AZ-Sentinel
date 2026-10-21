/**
 * Header nội bộ Worker -> hub đánh dấu kết nối của Gateway (Plan 3C). Route `/api/gw/ws` đặt nó;
 * route người xem xóa nó trước khi chuyển tiếp, nên trình duyệt không giả được. Hub chỉ nhận
 * được request qua binding nên không ai ngoài Worker gửi được.
 */
export const GW_HEADER = 'X-AZ-Gw'

/**
 * Mỗi kết nối Gateway giữ tối đa chừng này terminal. Danh sách terminal nằm trong storage của hub
 * (không còn nằm trong `serializeAttachment` 2 KB), nên giới hạn chỉ còn là chặn an toàn.
 */
export const MAX_GW_TERMS = 64
