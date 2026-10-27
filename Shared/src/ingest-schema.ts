import { z } from 'zod'

/** Lý do gửi (Plan 1 mục 3). */
export const REASONS = [
  'trade_event',
  'risk',
  'm5_bar',
  'volatility',
  'heartbeat',
  /** Plan 3B: lô mẫu gửi khi có người xem. */
  'live',
  /** Plan 3B: gửi bù nến M5 và sự kiện tích lại lúc idle. */
  'backfill',
] as const
export type Reason = (typeof REASONS)[number]

/** Loại lệnh/vị thế (Plan 1 mục 5). */
export const ORDER_TYPES = [
  'buy',
  'sell',
  'buy_limit',
  'sell_limit',
  'buy_stop',
  'sell_stop',
  'buy_stop_limit',
  'sell_stop_limit',
] as const

const shortText = (max: number) => z.string().max(max)
const price = z.number().finite()

export const positionSchema = z.object({
  ticket: z.number().int().nonnegative(),
  symbol: shortText(32),
  type: z.enum(ORDER_TYPES),
  volume: z.number().finite().nonnegative(),
  time: z.number().int().nonnegative(),
  price,
  sl: price.nullish(),
  tp: price.nullish(),
  profit: z.number().finite().optional(),
  swap: z.number().finite().optional(),
  comment: shortText(128).optional(),
  magic: z.number().int().optional(),
})
export type Position = z.infer<typeof positionSchema>

export const tradeEventSchema = z.object({
  kind: z.enum(['open', 'close', 'modify']),
  deal_ticket: z.number().int().nonnegative(),
  position_id: z.number().int().nonnegative(),
  symbol: shortText(32).optional(),
  type: z.enum(ORDER_TYPES).optional(),
  volume: z.number().finite().nonnegative().optional(),
  time: z.number().int().nonnegative(),
  price: price.optional(),
  sl: price.nullish(),
  tp: price.nullish(),
  profit: z.number().finite().optional(),
  swap: z.number().finite().optional(),
  commission: z.number().finite().optional(),
  comment: shortText(128).optional(),
  magic: z.number().int().optional(),
})
export type TradeEvent = z.infer<typeof tradeEventSchema>

export const accountSchema = z.object({
  login: z.number().int().positive(),
  name: shortText(128).optional(),
  broker: shortText(128).optional(),
  server: shortText(128).min(1),
  currency: shortText(8).optional(),
  leverage: z.number().int().nonnegative().optional(),
  mode: z.enum(['real', 'demo', 'contest']).optional(),
  margin_mode: z.enum(['hedging', 'netting', 'exchange']).optional(),
  balance: z.number().finite(),
  equity: z.number().finite(),
  margin: z.number().finite().optional(),
  margin_free: z.number().finite().optional(),
  margin_level: z.number().finite().nullish(),
  floating_pl: z.number().finite(),
})
export type Account = z.infer<typeof accountSchema>

export const MAX_POSITIONS = 200
/** Plan 3B: số mẫu tối đa mỗi lô live và số nến M5 bù tối đa (24 giờ). */
export const MAX_SAMPLES = 20
export const MAX_BARS = 288

/** Mẫu equity mỗi giây EA gom vào lô (Plan 3B mục 4). `t` là Unix giây. */
export const sampleSchema = z.object({
  t: z.number().int().nonnegative(),
  eq: z.number().finite(),
  bal: z.number().finite(),
  fl: z.number().finite(),
  ml: z.number().finite().nullish(),
  /** Margin đang dùng (ACCOUNT_MARGIN), từ EA 0.5.0; vắng ở EA cũ. */
  mg: z.number().finite().nonnegative().optional(),
})
export type Sample = z.infer<typeof sampleSchema>
export const MAX_EVENTS = 100

/**
 * Lãi/lỗ hiện tại của từng lệnh đang mở: `{ "<ticket>": profit }`. Gọn hơn nhiều so với gửi lại
 * toàn bộ `positions` mỗi tick (chỉ gửi `positions` khi cấu trúc danh sách đổi).
 */
export const plSchema = z
  .record(z.string().regex(/^[0-9]{1,20}$/), z.number().finite())
  .refine((o) => Object.keys(o).length <= MAX_POSITIONS, { message: 'quá nhiều lệnh' })
export type PositionPl = z.infer<typeof plSchema>
/** Giới hạn body ingest (Rules BE mục 7). */
export const MAX_INGEST_BODY_BYTES = 64 * 1024

/** Payload EA gửi lên POST /api/ea/v1/ingest (schema v1). */
export const ingestPayloadSchema = z.object({
  v: z.literal(1),
  sid: shortText(32).min(1),
  seq: z.number().int().nonnegative(),
  reason: z.array(z.enum(REASONS)).min(1).max(REASONS.length),
  ts_utc: z.number().int().nonnegative(),
  vps: shortText(64).optional(),
  ea_ver: shortText(16).optional(),
  account: accountSchema,
  /** Vắng mặt = "không đổi" (đường live chỉ gửi khi `pos_hash` đổi). */
  positions: z.array(positionSchema).max(MAX_POSITIONS).optional(),
  pending: z.array(positionSchema).max(MAX_POSITIONS).optional(),
  events: z.array(tradeEventSchema).max(MAX_EVENTS).default([]),
  samples: z.array(sampleSchema).max(MAX_SAMPLES).optional(),
  /** Nến M5 bù (`reason: backfill`); `t` = đầu nến. */
  bars: z.array(sampleSchema).max(MAX_BARS).optional(),
  pos_hash: z.string().max(64).optional(),
  truncated: z.boolean().optional(),
  total_positions: z.number().int().nonnegative().optional(),
})
export type IngestPayload = z.infer<typeof ingestPayloadSchema>

export type GateMode = 'live' | 'idle'

/** Phản hồi `GET /api/ea/v1/gate` (Plan 3B mục 4). */
export type GateResponse = {
  mode: GateMode
  interval_sec: number
  lease_sec: number
  next_poll_sec: number
  server_time: number
}

/** Phản hồi của server cho EA (Plan 1 mục 6). */
export type IngestResponse = {
  ack_seq: number
  next_interval_sec?: number
  commands: { type: 'set_interval' | 'ping'; value?: number }[]
  /** Plan 3B: cấp/thu hồi quyền live. Vắng mặt với client cũ (AZ_Spike). */
  mode?: GateMode
  interval_sec?: number
  lease_sec?: number
  next_poll_sec?: number
  server_time?: number
  duplicate?: boolean
  /** Chỉ có ở chế độ spike/dev. */
  meta?: { rows_written: number; rows_read: number }
}

/** Phản hồi GET /api/health (không lộ phiên bản hay cấu hình). */
export type HealthResponse = { status: 'ok' }
