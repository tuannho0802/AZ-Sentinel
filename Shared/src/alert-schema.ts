import { z } from 'zod'

/**
 * Thông báo cảnh báo lỗ float (Plan 5). Luồng: người dùng đặt ngưỡng (Server/Worker) -> Gateway nhận qua
 * `alert_cfg` -> EA nhận `alert_bp` trong phản hồi ping -> EA đo `Float P/L / Balance` và báo về Gateway
 * (`POST /v1/alert`) -> Gateway chuyển lên Server -> Server quyết định có thông báo hay không rồi lưu bảng
 * `notifications`. EA chỉ phát hiện, mọi luật chống lặp và so sánh nằm ở Server (một nguồn sự thật).
 */
export const ALERT = {
  /** Không báo lặp trong chừng này giây kể từ lần báo cảnh báo/tăng gần nhất của cùng một tài khoản. */
  cooldownSec: 3600,
  /** Sau thời gian chờ, chỉ báo "tăng" khi mức lỗ tăng ít nhất chừng này % so với lần báo trước. */
  minIncreasePct: 1,
  /** EA nhắc lại trạng thái "đang vượt ngưỡng" mỗi chừng này giây (Server lọc, EA chỉ giữ nhịp). */
  reportEverySec: 60,
  /** Ngưỡng tính theo basis point của Balance: 100 bp = 1%. Tối đa 100%. */
  maxLossBp: 10_000,
  /** Giữ thông báo tối đa chừng này ngày và chừng này dòng cho mỗi người. */
  keepDays: 30,
  keepPerOwner: 500,
  listLimit: 100,
} as const

/**
 * Cách tính "lỗ đã tăng X%":
 * - `balance`: (lỗ hiện tại - lỗ lần báo trước) / Balance hiện tại. Mặc định.
 * - `float`: (lỗ hiện tại - lỗ lần báo trước) / lỗ lần báo trước.
 */
export const GROWTH_MODES = ['balance', 'float'] as const
export type GrowthMode = (typeof GROWTH_MODES)[number]
export const DEFAULT_GROWTH_MODE: GrowthMode = 'balance'

export const NOTIFICATION_KINDS = ['warn', 'increase', 'clear'] as const
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

export const ALERT_REPORT_KINDS = ['breach', 'clear'] as const
export type AlertReportKind = (typeof ALERT_REPORT_KINDS)[number]

const num = z.number().finite()

/** Phần thân báo cáo của EA (dùng cho cả EA -> Gateway và Gateway -> cloud). */
export const alertFields = {
  /** Số thứ tự đơn điệu theo thời gian (Unix giây, tăng ít nhất 1 mỗi lần) để loại trùng khi gửi lại. */
  aseq: z.number().int().nonnegative(),
  kind: z.enum(ALERT_REPORT_KINDS),
  /** Unix giây UTC lúc EA đo. */
  ts: z.number().int().nonnegative(),
  bal: num,
  eq: num,
  fl: num,
  /** Số lệnh đang mở. */
  n: z.number().int().nonnegative(),
  ccy: z.string().max(8).optional(),
  /** Chỉ có ở `clear`: tổng lãi/lỗ đã chốt từ lúc bắt đầu đợt cảnh báo. */
  closed_pl: num.optional(),
}

export type AlertReportBody = {
  aseq: number
  kind: AlertReportKind
  ts: number
  bal: number
  eq: number
  fl: number
  n: number
  ccy?: string | undefined
  closed_pl?: number | undefined
}

/** `% lỗ` của Balance tính bằng basis point (100 bp = 1%). 0 khi không lỗ hoặc Balance không dương. */
export function lossBp(fl: number, bal: number): number {
  if (!(bal > 0) || !(fl < 0)) return 0
  return (-fl / bal) * 10_000
}

// ---------------------------------------------------------------------------
// API cho giao diện
// ---------------------------------------------------------------------------

/** Cài đặt cảnh báo của một người. `loss_pct` = 0 nghĩa là tắt. */
export const alertSettingsSchema = z.object({
  loss_pct: z
    .number()
    .finite()
    .min(0)
    .max(ALERT.maxLossBp / 100)
    .refine((v) => v === 0 || v >= 0.1, { message: 'Ngưỡng tối thiểu là 0,1%' }),
  /** Cách tính "đã tăng X%". Thiếu thì giữ chế độ đang lưu (mặc định `balance`). */
  growth_mode: z.enum(GROWTH_MODES).optional(),
})
export type AlertSettingsInput = z.infer<typeof alertSettingsSchema>
/** Cài đặt trả về giao diện (luôn đủ trường). */
export type AlertSettings = { loss_pct: number; growth_mode: GrowthMode }

export function pctToBp(pct: number): number {
  return Math.round(pct * 100)
}
export function bpToPct(bp: number): number {
  return bp / 100
}

export const notificationDataSchema = z.object({
  login: z.number().int().optional(),
  server: z.string().optional(),
  ccy: z.string().optional(),
  bal: num.optional(),
  fl: num.optional(),
  loss_pct: num.optional(),
  thr_pct: num.optional(),
  prev_fl: num.optional(),
  growth_pct: num.optional(),
  growth_mode: z.enum(GROWTH_MODES).optional(),
  since_sec: z.number().int().optional(),
  closed_pl: num.optional(),
})
export type NotificationData = z.infer<typeof notificationDataSchema>

export type NotificationView = {
  /** Mã chung giữa VPS và Cloudflare (không phải id tự tăng của từng DB). */
  id: string
  kind: NotificationKind
  title: string
  body: string
  link_id: number | null
  created_at: number
  read: boolean
  data: NotificationData
}

export type NotificationListResponse = { items: NotificationView[]; unread: number }

export const markReadRequestSchema = z.union([
  z.object({ all: z.literal(true) }),
  z.object({ ids: z.array(z.string().min(8).max(64)).min(1).max(200) }),
])
export type MarkReadRequest = z.infer<typeof markReadRequestSchema>

// ---------------------------------------------------------------------------
// Đồng bộ VPS <-> Cloudflare
// ---------------------------------------------------------------------------

export const syncAlertSettingRowSchema = z.object({
  owner_id: z.number().int().positive(),
  loss_bp: z.number().int().min(0).max(ALERT.maxLossBp),
  /** Thiếu (VPS bản cũ) thì coi là `balance`. */
  growth_mode: z.enum(GROWTH_MODES).default(DEFAULT_GROWTH_MODE),
  updated_at: z.number().int().nonnegative(),
})
export type SyncAlertSettingRow = z.infer<typeof syncAlertSettingRowSchema>

export const syncAlertStateRowSchema = z.object({
  link_id: z.number().int().positive(),
  episode_open: z.number().int().min(0).max(1),
  ep_started_at: z.number().int().nullable(),
  last_notified_at: z.number().int().nullable(),
  last_notified_fl: z.number().finite().nullable(),
  last_aseq: z.number().int().nonnegative(),
  updated_at: z.number().int().nonnegative(),
})
export type SyncAlertStateRow = z.infer<typeof syncAlertStateRowSchema>

export const syncNotificationRowSchema = z.object({
  uid: z.string().min(8).max(64),
  owner_id: z.number().int().positive(),
  link_id: z.number().int().positive().nullable(),
  kind: z.enum(NOTIFICATION_KINDS),
  title: z.string().max(200),
  body: z.string().max(1000),
  data_json: z.string().max(2000).nullable(),
  created_at: z.number().int().nonnegative(),
  read_at: z.number().int().nonnegative().nullable(),
  updated_at: z.number().int().nonnegative(),
})
export type SyncNotificationRow = z.infer<typeof syncNotificationRowSchema>

/** `GET /api/sync/notifications`: Cloudflare đã ghi hộ trong lúc dự phòng. `next` = id cục bộ cuối nếu còn trang sau. */
export const syncNotificationsPageSchema = z.object({
  notifications: z.array(syncNotificationRowSchema),
  next: z.number().int().nullable(),
})
export type SyncNotificationsPage = z.infer<typeof syncNotificationsPageSchema>

/** `GET /api/sync/alert-state`: bảng nhỏ (một dòng mỗi liên kết) nên không phân trang. */
export const syncAlertStatePageSchema = z.object({
  states: z.array(syncAlertStateRowSchema),
})
export type SyncAlertStatePage = z.infer<typeof syncAlertStatePageSchema>

// ---------------------------------------------------------------------------
// Định dạng chữ (tiếng Việt) dùng chung Server và giao diện
// ---------------------------------------------------------------------------

/** Số tiền tối đa 2 chữ số lẻ, bỏ số 0 thừa, không dấu phân cách nghìn. `signed` thêm dấu `+` cho số dương. */
export function formatMoney(value: number, signed = false): string {
  const rounded = Math.round(value * 100) / 100
  const text = Object.is(rounded, -0) ? '0' : String(rounded)
  return signed && rounded > 0 ? `+${text}` : text
}

/** Phần trăm tối đa 2 chữ số lẻ, bỏ số 0 thừa. */
export function formatPct(value: number): string {
  return String(Math.round(value * 100) / 100)
}

/** Khoảng thời gian: dưới 1 tiếng báo bằng phút ("45 phút"); từ 1 tiếng trở lên "1 tiếng 5 phút". */
export function formatDurationVi(sec: number): string {
  const minutes = Math.max(0, Math.floor(sec / 60))
  if (minutes < 1) return 'dưới 1 phút'
  if (minutes < 60) return `${minutes} phút`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h} tiếng` : `${h} tiếng ${m} phút`
}
