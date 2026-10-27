import { z } from 'zod'

/**
 * Whitelist THIẾT BỊ (đi cùng whitelist IP, Plan 3F). Mỗi thiết bị có một mã ngẫu nhiên: trình duyệt giữ
 * trong cookie `az_dev` (Server tự cấp), Gateway giữ trong file `device.id` và gửi bằng header `X-AZ-Device`.
 * Server băm mã đó (`deviceHashInput`) và chỉ lưu/so sánh bản băm.
 *
 * Hai chế độ cho một thiết bị đã duyệt:
 * - `any_ip`: thiết bị vào bằng IP nào thì IP đó được thêm vào whitelist IP luôn.
 * - `device_only`: chỉ duyệt thiết bị; IP chưa có trong whitelist vẫn bị chặn cho tới khi quản trị viên duyệt.
 */

export const DEVICE_MODES = ['any_ip', 'device_only'] as const
export type DeviceMode = (typeof DEVICE_MODES)[number]
export type DeviceKind = 'web' | 'gateway'

/** Cookie của trình duyệt (HttpOnly) và header của Gateway mang mã thiết bị thô. */
export const DEVICE_COOKIE = 'az_dev'
export const DEVICE_HEADER = 'X-AZ-Device'
/** Server đặt header này (mã đã băm) cho BE sau khi gỡ mọi header cùng tên do client gửi. */
export const DEVICE_ID_HEADER = 'X-AZ-Device-Id'

/** Cookie thiết bị sống 400 ngày (tối đa trình duyệt cho phép). */
export const DEVICE_COOKIE_MAX_AGE_SEC = 400 * 24 * 3600

/**
 * Trao mã thiết bị từ Worker sang tunnel (Plan 3K). Quick Tunnel đổi địa chỉ mỗi lần chạy lại nên cookie gắn
 * với địa chỉ tunnel mất theo. Worker (địa chỉ cố định) giữ mã thiết bị của trình duyệt, khi chuyển hướng sang
 * tunnel thì gắn một vé mã hóa ngắn hạn vào tham số này; Server giải vé, cấp lại cookie cho địa chỉ tunnel mới
 * rồi bỏ tham số khỏi URL. Nhờ vậy cùng một trình duyệt luôn là cùng một thiết bị, dù tunnel đổi bao nhiêu lần.
 */
export const DEVICE_HANDOFF_PARAM = 'az_dh'
export const DEVICE_HANDOFF_TTL_SEC = 60

/** Giá trị `Set-Cookie` của cookie thiết bị (một công thức duy nhất cho Worker và Server). */
export const deviceCookieHeader = (raw: string, secure: boolean): string =>
  `${DEVICE_COOKIE}=${raw}; Path=/; Max-Age=${DEVICE_COOKIE_MAX_AGE_SEC}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`

/**
 * "Cùng máy": app đã cài (PWA) hoặc trình duyệt khác trên CÙNG máy có kho cookie riêng nên bị coi là thiết bị mới.
 * Khi bật bảo vệ thiết bị, thiết bị web lạ đến từ đúng IP mà một thiết bị web đã được quản trị viên duyệt vừa dùng
 * (thấy trong `DEVICE_ADOPT_WINDOW_SEC` giây gần nhất, hoặc IP do thiết bị đó tự thêm) thì được duyệt theo, thừa kế
 * chế độ của thiết bị gốc. Mỗi IP tối đa `DEVICE_ADOPT_LIMIT` thiết bị loại này để không bị làm ngập danh sách.
 */
export const DEVICE_ADOPT_WINDOW_SEC = 7 * 24 * 3600
export const DEVICE_ADOPT_LIMIT = 5
export const DEVICE_ADOPT_PREFIX = 'Cùng máy: '
/** `server_meta` khóa này bằng '0' thì tắt tính năng (mặc định bật). */
export const DEVICE_ADOPT_META_KEY = 'device_adopt'

/** Số IP tối đa một thiết bị `any_ip` được tự thêm (vượt thì bỏ IP cũ nhất) để IP đổi liên tục không làm đầy danh sách. */
export const DEVICE_AUTO_IP_LIMIT = 20

const RAW_ID = /^[A-Za-z0-9_-]{24,64}$/
const HASHED_ID = /^[0-9a-f]{32}$/

export const isRawDeviceId = (v: unknown): v is string => typeof v === 'string' && RAW_ID.test(v)
export const isHashedDeviceId = (v: unknown): v is string =>
  typeof v === 'string' && HASHED_ID.test(v)

/** Chuỗi đem băm SHA-256 (lấy 32 ký tự hex đầu). Server và Gateway dùng chung để hiển thị cùng một mã. */
export const deviceHashInput = (raw: string): string => `az-device:${raw}`

/** Mã ngắn để người đọc đối chiếu (8 ký tự đầu của bản băm). */
export const shortDeviceId = (hashed: string): string => hashed.slice(0, 8)

const label = z.string().trim().max(64)

export const createDeviceRuleRequestSchema = z.object({
  device_id: z.string().trim().toLowerCase().regex(HASHED_ID, 'Mã thiết bị không hợp lệ'),
  label: label.default(''),
  mode: z.enum(DEVICE_MODES).default('device_only'),
})
export type CreateDeviceRuleRequest = z.infer<typeof createDeviceRuleRequestSchema>

export const updateDeviceRuleRequestSchema = z
  .object({ label: label.optional(), mode: z.enum(DEVICE_MODES).optional() })
  .refine((v) => v.label !== undefined || v.mode !== undefined, 'Không có gì để sửa')
export type UpdateDeviceRuleRequest = z.infer<typeof updateDeviceRuleRequestSchema>

export const setDeviceGuardRequestSchema = z.object({ enforce: z.boolean() })

export type DeviceRule = {
  id: number
  device_id: string
  kind: DeviceKind
  label: string
  mode: DeviceMode
  last_ip: string | null
  last_seen: number | null
  created_at: number
}

export type DevicePending = {
  device_id: string
  kind: DeviceKind
  ip: string
  user_agent: string
  last_at: number
  count: number
}

export type DeviceGuardState = {
  /** Bật = chỉ thiết bị trong danh sách (và máy chạy Server) mới vào được. Tắt = không xét thiết bị. */
  enforce: boolean
  /** Mã (đã băm) của thiết bị đang gọi API này; null khi gọi thẳng từ máy Server hoặc từ Cloudflare dự phòng. */
  your_device_id: string | null
  your_device_allowed: boolean
  rules: DeviceRule[]
  /** Thiết bị lạ vừa bị chặn (mới nhất trước) để quản trị viên duyệt bằng một cú bấm. */
  pending: DevicePending[]
}
