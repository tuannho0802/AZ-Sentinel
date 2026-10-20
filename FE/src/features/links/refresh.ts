/**
 * Chu kỳ tự làm mới của màn hình thử Liên kết EA (chỉ chạy ở local, không tốn hạn mức).
 * Quyết định: Rules FE mục 5 giữ 30 giây cho dashboard thật; riêng màn hình thử này cho chọn
 * 1/2/5/30 giây hoặc tắt để xem EA gửi nhanh (InpIntervalSec = 1). Mặc định 2 giây.
 */
export const REFRESH_OPTIONS_MS = [1000, 2000, 5000, 30_000] as const
export const DEFAULT_REFRESH_MS = 2000
