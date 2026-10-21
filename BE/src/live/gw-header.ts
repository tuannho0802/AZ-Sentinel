/**
 * Header nội bộ Worker -> hub đánh dấu kết nối của Gateway (Plan 3C). Route `/api/gw/ws` đặt nó;
 * route người xem xóa nó trước khi chuyển tiếp, nên trình duyệt không giả được. Hub chỉ nhận
 * được request qua binding nên không ai ngoài Worker gửi được.
 */
export const GW_HEADER = 'X-AZ-Gw'

/** Mỗi kết nối Gateway giữ tối đa chừng này terminal (giới hạn 2 KB của serializeAttachment). */
export const MAX_GW_TERMS = 12