import { z } from 'zod'
import { MAX_POSITIONS, MAX_SAMPLES, plSchema, positionSchema, sampleSchema } from './ingest-schema'
import { statsFields, statsSchema } from './stats-schema'
import { tradeResultFields } from './trade-schema'

/**
 * Giao thức live theo nhu cầu (Plan 3B). Hằng số dùng chung BE, FE, fake-ea; EA (MQL5) chép
 * giá trị mặc định vào input và luôn ưu tiên giá trị server trả về.
 */
export const LIVE = {
  /** Nhịp gửi live mặc định và biên kẹp (giây). Sàn 3 giây là giới hạn cứng của EA. */
  defaultIntervalSec: 10,
  minIntervalSec: 3,
  maxIntervalSec: 30,
  /** Quyền gửi live hết hạn sau chừng này giây nếu EA không nhận được gia hạn (dead-man switch). */
  leaseSec: 45,
  /**
   * FE coi liên kết là `idle` (không phản hồi) khi mẫu live cuối cũ hơn chừng này giây. Qua Gateway
   * EA gửi ít nhất mỗi giây nên 10 giây là im lặng thật; huy hiệu Live không còn hiện tuổi mẫu nên
   * phải hạ cờ nhanh hơn `leaseSec` (45 giây, dành cho đường HTTP cũ).
   */
  staleSec: 10,
  /** Chu kỳ hỏi gate khi không ai xem, và biên kẹp (giây). */
  idlePollSec: 120,
  minPollSec: 30,
  maxPollSec: 600,
  /** Hai ingest của cùng một liên kết cách nhau dưới mức này bị 429. */
  minIngestGapSec: 2,
  /** `link_state` ghi điều tiết: tối đa một lần mỗi chừng này giây khi live. */
  stateWriteSec: 60,
  /** Gate chỉ cập nhật `last_seen_at` tối đa một lần mỗi chừng này giây. */
  idleTouchSec: 240,
  /** Mẫu lệch quá chừng này giây so với giờ nhận thì server dùng giờ nhận. */
  sampleSkewSec: 120,
  /** FE gửi `hb` mỗi chừng này giây; hub coi viewer chết sau `viewerTimeoutSec` không có tin. */
  heartbeatSec: 25,
  viewerTimeoutSec: 60,
  maxTabsPerUser: 3,
} as const

/** Kẹp nhịp live vào [3, 30]; giá trị không hợp lệ dùng mặc định. */
export function clampIntervalSec(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null
  if (n === null) return LIVE.defaultIntervalSec
  return Math.min(LIVE.maxIntervalSec, Math.max(LIVE.minIntervalSec, n))
}

/** Kẹp chu kỳ gate vào [30, 600]; giá trị không hợp lệ dùng mặc định (120). */
export function clampPollSec(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null
  if (n === null) return LIVE.idlePollSec
  return Math.min(LIVE.maxPollSec, Math.max(LIVE.minPollSec, n))
}

/** Trạng thái live của một liên kết, hiển thị ở FE (Plan 3B mục 4). */
export const LIVE_STATES = ['waking', 'live', 'idle'] as const
export type LiveState = (typeof LIVE_STATES)[number]

export const KICK_REASONS = ['session_expired', 'too_many_tabs'] as const
export type KickReason = (typeof KICK_REASONS)[number]

export const LIVE_SCOPES = ['links', 'link'] as const

/**
 * Tin FE gửi lên hub. `hello` khai báo phạm vi xem: cả danh sách `/links` hoặc một liên kết
 * `/links/:id`. Quyền thật do server quyết định lúc nâng cấp WebSocket, không dựa vào tin này.
 */
export const clientMessageSchema = z.discriminatedUnion('t', [
  z
    .object({
      t: z.literal('hello'),
      scope: z.enum(LIVE_SCOPES),
      id: z.number().int().positive().optional(),
    })
    .refine((m) => m.scope !== 'link' || m.id !== undefined, { path: ['id'] }),
  z.object({ t: z.literal('hb') }),
])
export type ClientMessage = z.infer<typeof clientMessageSchema>

const liveStateSchema = z.enum(LIVE_STATES)
const linkIdSchema = z.number().int().positive()

/** Tin hub gửi xuống FE. FE kiểm tra bằng schema này ở biên (Rules FE mục 4). */
export const serverMessageSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('snapshot'),
    server_time: z.number().int(),
    links: z.array(
      z.object({
        id: linkIdSchema,
        live_state: liveStateSchema,
        sample: sampleSchema.nullable(),
        positions: z.array(positionSchema).max(MAX_POSITIONS).optional(),
        pos_hash: z.string().max(64).optional(),
        /** Thống kê lãi/lỗ theo kỳ gần nhất hub đang giữ (chỉ gửi cho người xem chi tiết). */
        stats: statsSchema.optional(),
      }),
    ),
  }),
  z.object({
    t: z.literal('samples'),
    id: linkIdSchema,
    server_time: z.number().int(),
    samples: z.array(sampleSchema).min(1).max(MAX_SAMPLES),
    /** Lãi/lỗ hiện tại từng lệnh (chỉ khi xem riêng một liên kết). */
    pl: plSchema.optional(),
  }),
  z.object({
    t: z.literal('positions'),
    id: linkIdSchema,
    server_time: z.number().int(),
    positions: z.array(positionSchema).max(MAX_POSITIONS),
    pos_hash: z.string().max(64).optional(),
  }),
  z.object({
    t: z.literal('live_state'),
    id: linkIdSchema,
    server_time: z.number().int(),
    state: liveStateSchema,
  }),
  /** Thống kê lãi/lỗ theo kỳ do EA tính, hub chuyển nguyên (chỉ cho người xem riêng liên kết `id`). */
  z.object({
    t: z.literal('stats'),
    id: linkIdSchema,
    server_time: z.number().int(),
    ...statsFields,
  }),
  /** Kết quả lệnh giao dịch thủ công của liên kết `id` (v0.2.6). FE ghép với lệnh đã gửi bằng `cmd_id`. */
  z.object({
    t: z.literal('trade_result'),
    id: linkIdSchema,
    server_time: z.number().int(),
    ...tradeResultFields,
  }),
  z.object({ t: z.literal('kick'), reason: z.enum(KICK_REASONS) }),
])
export type ServerMessage = z.infer<typeof serverMessageSchema>

/** Một phần tử của `snapshot`. */
export type SnapshotLink = Extract<ServerMessage, { t: 'snapshot' }>['links'][number]
