import { z } from 'zod'
import {
  MAX_EVENTS,
  MAX_POSITIONS,
  MAX_SAMPLES,
  plSchema,
  positionSchema,
  REASONS,
  sampleSchema,
  tradeEventSchema,
} from './ingest-schema'

/**
 * Giao thức Gateway (Plan 3C mục 3 và 4). Hằng số dùng chung Gateway, BE, test; EA (MQL5) chép
 * giá trị mặc định vào input và luôn ưu tiên giá trị Gateway trả về.
 */
export const GW = {
  defaultPort: 47800,
  /** EA ping Gateway mỗi chừng này giây (sàn 2). */
  pingSec: 5,
  minPingSec: 2,
  /** Dead-man switch của EA: quá chừng này ms không ping thành công thì ngừng gửi mẫu. */
  leaseMs: 15_000,
  /**
   * Nhịp tối thiểu giữa hai lần EA gửi `samples` cho Gateway (EA gửi theo `OnTick`, có sàn 1 giây
   * từ `OnTimer` khi thị trường không có tick), và biên kẹp (ms). Loopback nên gần như miễn phí.
   */
  defaultIntervalMs: 1000,
  minIntervalMs: 100,
  maxIntervalMs: 5000,
  /**
   * Terminal đang được xem RIÊNG (trang `/links/:id`): EA gửi theo tick, cách nhau tối thiểu chừng
   * này ms, và Gateway đẩy lên cloud cùng nhịp. Terminal chỉ nằm trong danh sách `/links` dùng
   * nhịp thường (`defaultPushSec`) để tiết kiệm request.
   */
  fastIntervalMs: 250,
  fastPushMs: 250,
  /** Nhịp Gateway gom `batch` gửi cloud cho terminal xem trong danh sách, và biên kẹp (giây). */
  defaultPushSec: 1,
  minPushSec: 1,
  maxPushSec: 5,
  /**
   * Mẫu y hệt lần đẩy trước (thị trường đóng, không tick) thì không đẩy lại, trừ một mẫu giữ sống
   * mỗi chừng này ms. Phải nhỏ hơn `LIVE.staleSec` (10 giây) để FE không hạ cờ Live nhầm.
   */
  keepAliveMs: 5000,
  /**
   * Không ai xem thì `event` (lệnh vào/ra) được giữ ở Gateway, chỉ đẩy lên cloud mỗi chừng này giây,
   * khi hàng đợi đạt `idleFlushQueue` lô, hoặc ngay khi có người bắt đầu xem. 0 = không giữ.
   */
  idleFlushSec: 1800,
  idleFlushQueue: 100,
  /** Terminal im quá chừng này giây thì Gateway coi là offline. */
  offlineAfterSec: 20,
  /** Cloud đóng kết nối nếu chưa `bind` hợp lệ trong chừng này giây. */
  bindTimeoutSec: 10,
  /** Ping giao thức Gateway → cloud (giây) và biên backoff nối lại (giây). */
  wsPingSec: 30,
  reconnectMinSec: 1,
  reconnectMaxSec: 60,
  /** Hàng đợi sự kiện ở Gateway. */
  maxQueue: 1000,
  maxBodyBytes: 128 * 1024,
} as const

export function clampPushSec(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null
  if (n === null) return GW.defaultPushSec
  return Math.min(GW.maxPushSec, Math.max(GW.minPushSec, n))
}

export function clampIntervalMs(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null
  if (n === null) return GW.defaultIntervalMs
  return Math.min(GW.maxIntervalMs, Math.max(GW.minIntervalMs, n))
}

/** Định danh terminal trong Gateway và cloud: `<login>@<server>`. */
export function terminalId(login: number, server: string): string {
  return `${login}@${server}`
}

const text = (max: number) => z.string().max(max)
const num = z.number().finite()
const accountMode = z.enum(['real', 'demo', 'contest'])

/** Ảnh chụp tài khoản gọn mà EA gửi kèm mỗi ping. */
export const snapSchema = z.object({
  bal: num,
  eq: num,
  margin: num.optional(),
  fl: num,
  ml: num.nullish(),
})
export type Snap = z.infer<typeof snapSchema>

// ---------------------------------------------------------------------------
// EA <-> Gateway (HTTP loopback)
// ---------------------------------------------------------------------------

const identity = z.object({
  v: z.literal(1),
  /** Phiên của EA, đổi mỗi lần EA khởi động. */
  sid: text(32).min(1),
  /** API key của liên kết. Gateway không bao giờ ghi log giá trị này. */
  key: text(128).min(1),
  login: z.number().int().positive(),
  server: text(128).min(1),
})

export const pingRequestSchema = identity.extend({
  ea_ver: text(16).default(''),
  mode: accountMode.default('real'),
  broker: text(128).optional(),
  name: text(128).optional(),
  /** Terminal có đang nối được broker không (`TERMINAL_CONNECTED`). */
  conn: z.boolean().default(true),
  snap: snapSchema,
})
export type PingRequest = z.infer<typeof pingRequestSchema>

export const samplesRequestSchema = identity.extend({
  seq: z.number().int().nonnegative(),
  samples: z.array(sampleSchema).min(1).max(MAX_SAMPLES),
  /** Vắng mặt = "không đổi" (EA chỉ gửi khi `pos_hash` đổi). */
  positions: z.array(positionSchema).max(MAX_POSITIONS).optional(),
  pos_hash: text(64).optional(),
  /** Lãi/lỗ từng lệnh khi cấu trúc không đổi (thay cho `positions`). */
  pl: plSchema.optional(),
  truncated: z.boolean().optional(),
  total_positions: z.number().int().nonnegative().optional(),
})
export type SamplesRequest = z.infer<typeof samplesRequestSchema>

export const eventRequestSchema = identity.extend({
  seq: z.number().int().nonnegative(),
  reason: z.array(z.enum(REASONS)).min(1).max(REASONS.length),
  events: z.array(tradeEventSchema).max(MAX_EVENTS).default([]),
  snap: snapSchema.optional(),
})
export type EventRequest = z.infer<typeof eventRequestSchema>

export const BIND_STATES = ['pending', 'ok', 'rejected'] as const
export type BindState = (typeof BIND_STATES)[number]

/** Phản hồi `POST /v1/ping` và `POST /v1/samples`. JSON gọn một dòng để EA tách chuỗi đơn giản. */
export type LocalPingResponse = {
  ok: true
  bind: BindState
  /** Mã từ chối của cloud (401, 403, 409) khi `bind = rejected`, ngược lại 0. */
  code: number
  watch: boolean
  interval_ms: number
  lease_ms: number
}

/** Phản hồi `POST /v1/event`. `ack_seq` chỉ nghĩa là Gateway đã nhận và lưu hàng đợi. */
export type LocalEventResponse = { ok: true; ack_seq: number }

export type LocalErrorResponse = { ok: false; error: string }

// ---------------------------------------------------------------------------
// Gateway -> Cloud (WebSocket)
// ---------------------------------------------------------------------------

const tid = text(160).min(3)

export const gwClientMessageSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('hello'),
    v: z.literal(1),
    gw_ver: text(16),
    vps: text(64).optional(),
    os: text(32).optional(),
  }),
  z.object({
    t: z.literal('bind'),
    tid,
    key: text(128).min(1),
    login: z.number().int().positive(),
    server: text(128).min(1),
    mode: accountMode,
    broker: text(128).optional(),
    name: text(128).optional(),
    /** Phiên bản EA (từ `ping`), để UI biết terminal đang chạy bản EA nào. */
    ea_ver: text(32).optional(),
  }),
  z.object({
    t: z.literal('state'),
    tid,
    online: z.boolean(),
    snap: snapSchema.optional(),
    /** Gửi lại khi EA đổi phiên bản (biên dịch lại) dù trạng thái online không đổi. */
    ea_ver: text(32).optional(),
  }),
  z.object({
    t: z.literal('batch'),
    items: z
      .array(
        z.object({
          tid,
          samples: z.array(sampleSchema).max(MAX_SAMPLES),
          positions: z.array(positionSchema).max(MAX_POSITIONS).optional(),
          pos_hash: text(64).optional(),
          pl: plSchema.optional(),
        }),
      )
      .min(1),
  }),
  z.object({
    t: z.literal('event'),
    tid,
    seq: z.number().int().nonnegative(),
    reason: z.array(z.enum(REASONS)).min(1),
    events: z.array(tradeEventSchema).max(MAX_EVENTS),
    snap: snapSchema.optional(),
  }),
])
export type GwClientMessage = z.infer<typeof gwClientMessageSchema>

/** Mã `reject`: 401 khóa sai, 403 khóa bị khóa, 409 khóa đã gắn tài khoản khác. */
export const GW_REJECT_CODES = [401, 403, 409] as const

export const gwServerMessageSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('bound'), tid, link_id: z.number().int().positive() }),
  z.object({ t: z.literal('reject'), tid, code: z.number().int() }),
  z.object({
    t: z.literal('watch'),
    tids: z.array(tid).max(500),
    push_sec: z.number(),
    /** Tập con của `tids` đang được xem riêng (trang `/links/:id`): đẩy theo tick. Vắng = rỗng. */
    fast: z.array(tid).max(500).optional(),
  }),
  z.object({ t: z.literal('ack'), tid, seq: z.number().int().nonnegative() }),
  z.object({
    t: z.literal('update'),
    min_ver: text(16),
    url: text(512),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
])
export type GwServerMessage = z.infer<typeof gwServerMessageSchema>
