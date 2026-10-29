import type { KickReason, Position, PositionPl, Sample, UserRole } from '@az-sentinel/shared'

/** Phạm vi liên kết mà một kết nối người xem được phép xem (do server quyết định, không do FE). */
export type LiveScope =
  | { kind: 'all' }
  | { kind: 'owner'; ownerId: number }
  | { kind: 'link'; linkId: number }

/** Liên kết mà hub được hỏi tới. `ownerId` lấy từ D1 cùng lượt tra khóa, hub không đọc D1. */
export type HubLinkRef = { linkId: number; ownerId: number | null }

/** Người xem do Worker xác thực rồi chuyển cho hub qua header nội bộ (hub không tự xác thực). */
export type ViewerInfo = {
  userId: number
  role: UserRole
  scope: LiveScope
  /** Hết phiên (ms); null = không hết hạn. Hub đóng kết nối với `session_expired` khi quá hạn. */
  expiresAt: number | null
  /** Giờ Worker nhận yêu cầu (ms), để mốc `lastBeatAt` ban đầu cùng đồng hồ với các RPC. */
  nowMs: number
}

export type PublishInput = {
  ref: HubLinkRef
  sid: string
  seq: number
  /** Đã chuẩn hóa (giờ tin cậy, tăng dần, tối đa 20); có thể rỗng (ví dụ lô backfill). */
  samples: Sample[]
  /** Vắng mặt = "không đổi". Có mặt = danh sách đầy đủ hiện tại (profit đã cập nhật). */
  positions?: Position[]
  posHash?: string
  /** Lãi/lỗ hiện tại từng lệnh khi `positions` vắng mặt (đường Gateway, xem theo tick). */
  pl?: PositionPl
  nowMs: number
}

export type PublishResult = {
  /** Có ít nhất một người xem còn sống muốn xem liên kết này. false => EA phải dừng. */
  wanted: boolean
  /** Trùng (sid, seq) trong bộ nhớ hub: không phát lại. */
  duplicate: boolean
  /** Hai ingest cách nhau dưới 2 giây: Worker trả 429 kèm Retry-After. */
  rateLimited: boolean
  retryAfterSec: number
  /** Ingest đầu tiên của một nến M5 mới (theo giờ nhận): Worker ghi nến M5. */
  barDue: boolean
  /** Cấu trúc danh sách lệnh đổi (pos_hash khác lần trước): Worker ghi positions_json. */
  posChanged: boolean
}

export type HubStats = {
  viewers: number
  /** Số Gateway đang nối WebSocket vào hub (hiện trên thẻ máy chủ). */
  gateways: number
  linksTracked: number
  /** Số lời gọi RPC từ lúc hub khởi tạo (bộ nhớ, mất khi hub ngủ đông). Chỉ để đo/chẩn đoán. */
  rpcCalls: number
}

/** Phần RPC của hub mà Worker dùng; tách thành interface để test chèn hub giả (lỗi, chậm). */
export interface HubClient {
  shouldBeLive(ref: HubLinkRef, nowMs: number): Promise<{ wanted: boolean }>
  publish(input: PublishInput): Promise<PublishResult>
}

/** Trạng thái lưu cùng mỗi WebSocket qua `serializeAttachment` (sống sót qua ngủ đông). */
export type ConnAttachment = {
  connId: string
  userId: number
  role: UserRole
  scope: LiveScope
  /** Mốc tin cuối nhận được từ người xem (ms). Quá 60 giây là viewer chết. */
  lastBeatAt: number
  expiresAt: number | null
  /** Đã gửi `hello` hợp lệ: chỉ khi đó mới nhận tin phát. */
  hello: boolean
}

export type KickMessage = { t: 'kick'; reason: KickReason }

/** Một terminal đã `bind` qua Gateway. Nằm trong attachment nên sống sót qua ngủ đông. */
export type GwTerm = {
  tid: string
  linkId: number
  ownerId: number | null
  online: boolean
  /** Phiên bản EA (từ `bind`/`state`) để ghi vào link_state; rỗng = không ghi. */
  ea: string
}

/**
 * Trạng thái nhỏ lưu cùng mỗi WebSocket của Gateway (giới hạn 2 KB). Danh sách terminal KHÔNG nằm
 * ở đây mà ở storage của hub, khóa `gw:<connId>` (xem `LiveHub.loadTerms`).
 */
export type GwAttachment = {
  connId: string
  openedAt: number
  lastBeatAt: number
  hello: boolean
  vps: string | null
  /** Phiên bản Gateway báo trong `hello` (để Server quyết định có ép cập nhật không). Cắt ngắn. */
  gwVer?: string
  /** Token cá nhân đã xác thực lúc nối (Plan 4). Hub đá kết nối khi token này bị thu hồi/đặt lại. */
  tokenId: number
  /** Chủ token: mọi liên kết bind qua kết nối này phải thuộc người này. */
  tokenOwnerId: number
}
