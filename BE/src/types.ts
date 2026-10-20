import type { LiveHub } from './live/live-hub'

export type Bindings = {
  DB: D1Database
  /** Durable Object toàn cục: người xem WebSocket và phát dữ liệu live (Plan 3B). */
  LIVE_HUB: DurableObjectNamespace<LiveHub>
  /** Nhịp live gửi cho EA (giây), kẹp 3-30. Mặc định 10. */
  LIVE_INTERVAL_SEC?: string
  /** Chu kỳ EA hỏi gate khi không ai xem (giây), kẹp 30-600. Mặc định 120. */
  GATE_POLL_SEC?: string
  /** Origin được phép mở WebSocket ngoài cùng origin, phân tách bằng dấu phẩy. */
  LIVE_ALLOWED_ORIGINS?: string
  /** "1" = trả meta rows_written/rows_read trong phản hồi ingest (chỉ dev/spike). */
  INGEST_DEBUG_META?: string
  /** "1" = bật /api/dev/* (quản lý liên kết không cần đăng nhập). Chỉ truyền bằng `wrangler dev --var`, KHÔNG đặt trong wrangler.jsonc. */
  DEV_LINKS_API?: string
}

export type AppEnv = {
  Bindings: Bindings
  Variables: { requestId: string }
}
