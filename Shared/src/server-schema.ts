import { z } from 'zod'
import { syncTokenRowSchema } from './token-schema'
import { syncUserRowSchema } from './user-schema'

/**
 * Plan 3E: VPS là máy chủ chính, Cloudflare là dự phòng. Mọi hằng số và schema dùng chung giữa
 * Worker (BE), máy chủ VPS (Server), Gateway và FE nằm ở đây để hai phía không lệch nhau.
 */

export const SERVER_ROLES = ['vps', 'cloudflare'] as const
export type ServerRole = (typeof SERVER_ROLES)[number]

/** Mọi phản hồi `/api/*` mang header này để FE biết node nào vừa trả lời (chỉ là vai trò, không lộ tên máy). */
export const SERVED_BY_HEADER = 'X-AZ-Served-By'
/** `primary` (VPS đang phục vụ), `fallback` (VPS đã cấu hình nhưng đang sập), `standalone` (chỉ có Cloudflare). */
export const SERVER_MODE_HEADER = 'X-AZ-Mode'

export const SERVER_MODES = ['primary', 'fallback', 'standalone'] as const
export type ServerMode = (typeof SERVER_MODES)[number]

export const FAILOVER = {
  /** Worker nhớ kết quả dò VPS chừng này ms (VPS đang sống: dò thưa; đang sập: dò dày để quay về sớm). */
  probeOkTtlMs: 10_000,
  probeDownTtlMs: 5_000,
  probeTimeoutMs: 2_500,
  /** Chờ VPS trả header tối đa chừng này ms trước khi coi là sập (sau đó Worker tự xử lý). */
  proxyTimeoutMs: 8_000,
  /** VPS báo nhịp sống lên Cloudflare mỗi chừng này giây (để UI dự phòng còn hiện thông tin VPS lần cuối). */
  heartbeatSec: 120,
  /** Nhịp sống cũ hơn chừng này giây thì coi thông tin VPS là cũ. */
  heartbeatStaleSec: 600,
  /** Đồng bộ VPS -> Cloudflare: tối đa chừng này dòng mỗi lần, và chu kỳ xả hàng đợi (giây). */
  syncBatch: 50,
  syncFlushSec: 5,
  /** VPS kéo các lệnh ghi trong lúc dự phòng về lại sau mỗi chừng này giây (và khi khởi động). */
  pullSec: 3600,
  /** Khi kéo, lùi mốc thêm chừng này giây để không lỡ dòng sát ranh giới. */
  pullOverlapSec: 3600,
} as const

const shortText = z.string().max(128)

/** Thông tin một node (máy chủ). Không chứa bí mật; người xem đã đăng nhập mới được đọc. */
export const serverNodeSchema = z.object({
  role: z.enum(SERVER_ROLES),
  /** Tên do người vận hành đặt (`AZ_SRV_NAME`), Cloudflare thì cố định. */
  name: z.string().max(64),
  host: shortText.nullable(),
  os: shortText.nullable(),
  arch: z.string().max(32).nullable(),
  /** Ví dụ `node v22.22.2` hoặc `cloudflare-workers`. */
  runtime: z.string().max(64),
  version: z.string().max(32),
  /** Unix giây lúc tiến trình (hoặc isolate) khởi động. */
  startedAt: z.number().int().nonnegative(),
  uptimeSec: z.number().int().nonnegative(),
  cpuCount: z.number().int().positive().nullable(),
  memTotalMb: z.number().int().nonnegative().nullable(),
  memFreeMb: z.number().int().nonnegative().nullable(),
  /** CPU đang dùng 0-100; null khi chưa đo được. */
  cpuPct: z.number().min(0).max(100).nullable(),
  /** Vị trí hiển thị: trung tâm dữ liệu Cloudflare (colo) hoặc nhãn VPS. */
  location: z.string().max(64).nullable(),
})
export type ServerNode = z.infer<typeof serverNodeSchema>

export const primaryStatusSchema = z.object({
  /** Worker có cấu hình VPS (`VPS_ORIGIN`) không. */
  configured: z.boolean(),
  status: z.enum(['up', 'down', 'unknown']),
  /** Unix giây lần cuối thấy VPS sống (nhịp sống hoặc lần dò thành công). */
  lastSeenAt: z.number().int().nullable(),
  /** Thông tin VPS: trực tiếp khi VPS sống, nhịp sống gần nhất khi VPS sập. */
  info: serverNodeSchema.nullable(),
})

export type PrimaryStatus = z.infer<typeof primaryStatusSchema>

export const standbyStatusSchema = z.object({
  configured: z.boolean(),
  lastSyncAt: z.number().int().nullable(),
  /** Số thay đổi còn chờ đẩy sang Cloudflare. */
  pending: z.number().int().nonnegative().nullable(),
  lastError: z.string().max(200).nullable(),
})
export type StandbyStatus = z.infer<typeof standbyStatusSchema>

/** Phản hồi `GET /api/server-info`. */
export const serverInfoSchema = z.object({
  mode: z.enum(SERVER_MODES),
  /** Node đang phục vụ người dùng lúc này. */
  active: serverNodeSchema,
  primary: primaryStatusSchema,
  /** Chỉ có khi VPS là node đang phục vụ: tình trạng đồng bộ sang Cloudflare. */
  standby: standbyStatusSchema.nullable(),
  /** Số Gateway đang nối và số người xem đang mở live ở node đang phục vụ. */
  gateways: z.number().int().nonnegative(),
  viewers: z.number().int().nonnegative(),
  checkedAt: z.number().int(),
  primaryUrl: z.string().max(256).nullable().optional(),
  fallbackUrl: z.string().max(256).nullable().optional(),
})
export type ServerInfo = z.infer<typeof serverInfoSchema>

/** `GET /api/server-info/self`: Worker hỏi VPS (bằng token dịch vụ) để ghép vào `server-info`. */
export const serverSelfSchema = z.object({
  node: serverNodeSchema,
  standby: standbyStatusSchema.nullable(),
  gateways: z.number().int().nonnegative(),
  viewers: z.number().int().nonnegative(),
  fallbackUrl: z.string().max(256).nullable().optional(),
})
export type ServerSelf = z.infer<typeof serverSelfSchema>

// ------------------------------------------------------------------ đồng bộ VPS -> Cloudflare

const hex64 = z.string().regex(/^[0-9a-f]{64}$/)
const nullableText = z.string().max(256).nullable()
const nullableInt = z.number().int().nullable()
const nullableNum = z.number().finite().nullable()

/** Dòng `ea_links` đồng bộ nguyên văn (giữ `id` để hai DB dùng chung số liên kết). */
export const syncLinkRowSchema = z.object({
  id: z.number().int().positive(),
  owner_id: nullableInt,
  login: nullableInt,
  server: nullableText,
  broker: nullableText,
  name: nullableText,
  currency: nullableText,
  mode: nullableText,
  key_hash: hex64,
  key_prefix: z.string().max(16),
  status: z.enum(['active', 'disabled']),
  bound_at: nullableInt,
  created_at: z.number().int(),
  vps_name: nullableText,
})
export type SyncLinkRow = z.infer<typeof syncLinkRowSchema>

export const syncTradeRowSchema = z.object({
  link_id: z.number().int().positive(),
  ticket: z.number().int(),
  symbol: nullableText,
  type: nullableText,
  volume: nullableNum,
  open_time: nullableInt,
  open_price: nullableNum,
  close_time: nullableInt,
  close_price: nullableNum,
  sl: nullableNum,
  tp: nullableNum,
  profit: nullableNum,
  swap: nullableNum,
  commission: nullableNum,
  comment: z.string().max(512).nullable(),
  magic: nullableInt,
})
export type SyncTradeRow = z.infer<typeof syncTradeRowSchema>

const SYNC_MAX_ROWS = 100

/** `POST /api/sync/apply`: một lô thay đổi; upsert theo khóa nên gửi lại bao nhiêu lần cũng không hại. */
export const syncApplySchema = z.object({
  users: z.array(syncUserRowSchema).max(SYNC_MAX_ROWS).default([]),
  tokens: z.array(syncTokenRowSchema).max(SYNC_MAX_ROWS).default([]),
  links: z.array(syncLinkRowSchema).max(SYNC_MAX_ROWS).default([]),
  links_deleted: z.array(z.number().int().positive()).max(SYNC_MAX_ROWS).default([]),
  trades: z.array(syncTradeRowSchema).max(SYNC_MAX_ROWS).default([]),
  trades_deleted: z
    .array(z.object({ link_id: z.number().int().positive(), ticket: z.number().int() }))
    .max(SYNC_MAX_ROWS)
    .default([]),
})
export type SyncApply = z.infer<typeof syncApplySchema>

/** `POST /api/sync/heartbeat`. */
export const syncHeartbeatSchema = z.object({
  node: serverNodeSchema,
  sentAt: z.number().int(),
})
export type SyncHeartbeat = z.infer<typeof syncHeartbeatSchema>

/** `GET /api/sync/links`: trang `ea_links` (VPS kéo lần khởi động đầu). */
export const syncLinksPageSchema = z.object({
  links: z.array(syncLinkRowSchema),
  next: z.number().int().nullable(),
})
export type SyncLinksPage = z.infer<typeof syncLinksPageSchema>

/** `GET /api/sync/tokens`: trang `gw_tokens` (VPS kéo lần khởi động đầu để nhận token cấp từ Cloudflare). */
export const syncTokensPageSchema = z.object({
  tokens: z.array(syncTokenRowSchema),
  next: z.number().int().nullable(),
})
export type SyncTokensPage = z.infer<typeof syncTokensPageSchema>

/** `GET /api/sync/trades`: trang các lệnh Cloudflare đã ghi (VPS kéo về sau khi sống lại). */
export const syncTradesPageSchema = z.object({
  trades: z.array(syncTradeRowSchema),
  /** Có khi còn trang sau: gửi lại làm `after_link`/`after_ticket`. */
  next: z.object({ link_id: z.number().int(), ticket: z.number().int() }).nullable(),
})
export type SyncTradesPage = z.infer<typeof syncTradesPageSchema>
