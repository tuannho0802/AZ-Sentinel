import type {
  GatewayOffer,
  ServerMode,
  ServerNode,
  ServerRole,
  StandbyStatus,
  UpdateStatus,
} from '@az-sentinel/shared'
import type { LiveHub } from './live/live-hub'
import type { Viewer } from './live/viewer-auth'

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
  /** Plan 3J: binding tới static assets (giao diện) của Worker; có thì Worker tự xử lý lượt tải trang (chuyển hướng hoặc phục vụ dự phòng). */
  ASSETS?: Fetcher
  /** Plan 3J: "0" = không chuyển hướng trang sang tunnel (luôn phục vụ giao diện tại Worker); "1" = chuyển cả sang `VPS_ORIGIN` đặt tay. Mặc định chỉ chuyển sang Quick Tunnel VPS đã báo. */
  PAGE_REDIRECT?: string
  /** Chỉ máy chủ VPS (Node) cung cấp; Worker không có. */
  HOST?: HostHooks
}

/** Móc do máy chủ VPS (Node) cung cấp để BE biết mình đang chạy ở đâu. */
export type HostHooks = {
  role: ServerRole
  describe: () => ServerNode
  standby: () => StandbyStatus | null
  fallbackUrl?: string | null
  /** Bản cập nhật bộ cài mà VPS đã thấy trên GitHub Releases; không có = VPS không kiểm tra. */
  updates?: () => UpdateStatus | null
  /**
   * Bản Gateway mới nhất đủ file để tự cập nhật (exe và băm đã kiểm). Có thì hub ép mọi Gateway cũ hơn đang nối tự cập nhật
   * (tin `update`); không có (hoặc Worker, không có HOST) = không ép.
   */
  gatewayOffer?: () => GatewayOffer | null
}

export type AppEnv = {
  Bindings: Bindings
  Variables: {
    requestId: string
    /** Node thực sự phục vụ request (đặt bởi bộ định tuyến biên hoặc route `server-info`). */
    servedBy?: ServerRole
    mode?: ServerMode
    /** Người đã xác thực của request hiện tại (đặt bởi middleware của route quản trị). */
    viewer?: Viewer
  }
}
