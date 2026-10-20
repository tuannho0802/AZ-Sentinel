import type { KickReason, Position, Sample, UserRole } from '@az-sentinel/shared'

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