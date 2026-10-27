import { z } from 'zod'
import { alertFields } from './alert-schema'
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
import {
  CLOSE_ALL_FILTERS,
  CMD_ID,
  ORDER_SIDES,
  PENDING_KINDS,
  SYMBOL_RE,
  TRADE_OPS,
  tradeResultFields,
} from './trade-schema'

/**
 * Giao thức Gateway (Plan 3C mục 3 và 4). Hằng số dùng chung Gateway, BE, test; EA (MQL5) chép
 * giá trị mặc định vào input và luôn ưu tiên giá trị Gateway trả về.
 */
/**
 * Khóa đặc biệt: EA không có API key riêng (để trống `InpApiKey`) thì gửi giá trị này. Gateway chuyển
 * nguyên sang cloud; BE thấy khóa này thì tự tìm hoặc tạo liên kết cho (server, login) dưới chủ của
 * token Gateway đang dùng (xem `bindTerminalAuto`). Khóa cũ vẫn dùng được như trước.
 */
export const AUTO_KEY = 'auto'

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

export const identity = z.object({
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

/** EA báo cảnh báo lỗ float cho Gateway (`POST /v1/alert`). */
export const alertRequestSchema = identity.extend(alertFields)
export type AlertRequest = z.infer<typeof alertRequestSchema>

/** Phản hồi `POST /v1/alert`: Gateway đã nhận và giữ để gửi lên cloud (chưa nghĩa là cloud đã nhận). */
export type LocalAlertResponse = { ok: true; ack_aseq: number }

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
  /**
   * Ngưỡng cảnh báo lỗ float theo basis point của Balance (500 = 5%), 0 = tắt. Đặt ở Server/Worker, Gateway chỉ
   * chuyển tiếp; EA không có input riêng cho việc này.
   */
  alert_bp: number
  /**
   * Lệnh giao dịch thủ công đang chờ EA (v0.2.6). Phẳng, tiền tố `tr_`, để EA (MQL5) tách bằng tìm chuỗi.
   * Vắng cả nhóm = không có lệnh. `tr_ttl` là số ms CÒN LẠI của hạn dùng tại lúc Gateway trả lời.
   * `tr_ticket` có với close/partial_close/modify. `tr_vol` có với partial_close, market, pending.
   * `tr_sl`/`tr_tp` có với modify, market, pending (0 = bỏ). Pha 2: `tr_sym` (market, pending), `tr_side`
   * (market), `tr_kind` (pending), `tr_px` (giá vào lệnh chờ), `tr_filter` (close_all).
   */
  tr_id?: string
  tr_op?: (typeof TRADE_OPS)[number]
  tr_ticket?: number
  tr_vol?: number
  tr_sl?: number
  tr_tp?: number
  tr_sym?: string
  tr_side?: (typeof ORDER_SIDES)[number]
  tr_kind?: (typeof PENDING_KINDS)[number]
  tr_px?: number
  tr_filter?: (typeof CLOSE_ALL_FILTERS)[number]
  tr_ttl?: number
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
  z.object({ t: z.literal('alert'), tid, ...alertFields }),
  /** Kết quả lệnh giao dịch thủ công (v0.2.6). */
  z.object({ t: z.literal('trade_result'), tid, ...tradeResultFields }),
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
  /** Ngưỡng cảnh báo lỗ float của chủ token (basis point, 0 = tắt). Gửi sau `hello` và mỗi khi người dùng đổi. */
  z.object({ t: z.literal('alert_cfg'), loss_bp: z.number().int().min(0).max(10_000) }),
  /** Server đã xử lý báo cáo cảnh báo `aseq` của terminal: Gateway ngừng gửi lại. */
  z.object({ t: z.literal('alert_ack'), tid, aseq: z.number().int().nonnegative() }),
  /**
   * Lệnh giao dịch thủ công cho một terminal (v0.2.6). Gateway giữ tối đa một lệnh mỗi terminal và
   * chuyển cho EA qua phản hồi ping/samples. Trường nào bắt buộc cho `op` nào do Gateway kiểm (`acceptTrade`).
   */
  z.object({
    t: z.literal('trade'),
    tid,
    cmd_id: z.string().regex(CMD_ID),
    op: z.enum(TRADE_OPS),
    ticket: z.number().int().positive().optional(),
    volume: z.number().finite().positive().optional(),
    sl: z.number().finite().nonnegative().optional(),
    tp: z.number().finite().nonnegative().optional(),
    symbol: z.string().regex(SYMBOL_RE).optional(),
    side: z.enum(ORDER_SIDES).optional(),
    kind: z.enum(PENDING_KINDS).optional(),
    price: z.number().finite().positive().optional(),
    filter: z.enum(CLOSE_ALL_FILTERS).optional(),
  }),
  z.object({
    t: z.literal('update'),
    min_ver: text(16),
    url: text(512),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
])
export type GwServerMessage = z.infer<typeof gwServerMessageSchema>
