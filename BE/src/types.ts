import type { ServerMode, ServerNode, ServerRole, StandbyStatus } from '@az-sentinel/shared'
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
  /**
   * Bí mật chung giữa Worker và mọi Gateway: Gateway gửi `Authorization: Bearer <token>` khi mở
   * `/api/gw/ws`. Thiếu hoặc sai thì Worker từ chối TRƯỚC khi đụng tới hub, nên request lạ không
   * đánh thức Durable Object. Đặt bằng `wrangler secret put GW_CONNECT_TOKEN`. Không đặt thì chỉ
   * cho phép khi chạy dev (DEV_LINKS_API=1).
   */
  GW_CONNECT_TOKEN?: string
  /** "1" = bật /api/dev/* (quản lý liên kết không cần đăng nhập). Chỉ truyền bằng `wrangler dev --var`, KHÔNG đặt trong wrangler.jsonc. */
  DEV_LINKS_API?: string
  /** Plan 3E: địa chỉ gốc (https) của VPS chính (thường là hostname Cloudflare Tunnel). Rỗng = chỉ chạy Cloudflare. */
  VPS_ORIGIN?: string
  /** Bí mật dịch vụ giữa Worker và VPS (`wrangler secret put SYNC_TOKEN`). */
  SYNC_TOKEN?: string
  /** Tên hiển thị của node Cloudflare. Mặc định "Cloudflare". */
  SERVER_NAME?: string
  /** "1" = cho phép ghi liên kết (`/api/dev/*`) khi đang dự phòng. Mặc định chặn để hai DB không lệch nhau. */
  FALLBACK_WRITABLE?: string
  /** URL công khai của VPS (UI dự phòng gợi ý quay về). Chỉ để hiển thị. */
  PRIMARY_URL?: string
  /** URL công khai của bản dự phòng Cloudflare (UI VPS gợi ý khi VPS sập). Chỉ để hiển thị. */
  FALLBACK_URL?: string
  /** Chỉ máy chủ VPS (Node) cung cấp; Worker không có. */
  HOST?: HostHooks
}

/** Móc do máy chủ VPS (Node) cung cấp để BE biết mình đang chạy ở đâu. */
export type HostHooks = {
  role: ServerRole
  describe: () => ServerNode
  standby: () => StandbyStatus | null
  fallbackUrl?: string | null
}

export type AppEnv = {
  Bindings: Bindings
  Variables: {
    requestId: string
    /** Node thực sự phục vụ request (đặt bởi bộ định tuyến biên hoặc route `server-info`). */
    servedBy?: ServerRole
    mode?: ServerMode
  }
}
