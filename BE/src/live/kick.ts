import type { Bindings } from '../types'
import { HUB_NAME } from './routes/live-ws'

/**
 * Đá mọi kết nối live (WebSocket) của một người dùng khỏi hub. Gọi sau khi khóa tài khoản, hạ/đổi vai
 * trò hoặc đặt lại mật khẩu: socket đang mở mang phạm vi xem và hạn phiên CŨ nên nếu không đá thì vẫn
 * nhận dữ liệu đến hết hạn phiên. Hub lỗi không chặn thao tác (phiên đã bị xóa ở DB, HTTP đã bị chặn).
 */
export async function kickUserAtHub(env: Bindings, userId: number): Promise<void> {
  try {
    await env.LIVE_HUB.getByName(HUB_NAME).kickUser(userId, 'session_expired')
  } catch {
    // hub không sẵn sàng: socket tự đóng khi tới hạn phiên
  }
}
