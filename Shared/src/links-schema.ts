import type { Position } from './ingest-schema'

/**
 * Hình dạng dữ liệu "Liên kết EA" cho màn hình quản lý (DEV, Part 1).
 * Khi có xác thực thật (Part 2/3) các endpoint sẽ có phân quyền; hình dạng có thể đổi.
 */

/**
 * Plan 3B: lúc không ai xem EA chỉ hỏi gate mỗi 120 giây và `last_seen_at` ghi tối đa mỗi 240
 * giây, nên tuổi tối đa bình thường ~360 giây. 420 giây chừa biên cho jitter.
 */
export const LINK_ONLINE_THRESHOLD_SECONDS = 420

export const LINK_STATUSES = ['active', 'disabled'] as const
export type LinkStatus = (typeof LINK_STATUSES)[number]

export type LinkAccountView = {
  login: number
  server: string
  broker: string | null
  name: string | null
  currency: string | null
  mode: string | null
}

export type LinkStateView = {
  balance: number | null
  equity: number | null
  margin: number | null
  margin_free: number | null
  margin_level: number | null
  floating_pl: number | null
  last_reason: string | null
  last_seen_at: number
  last_seq: number | null
  ea_ver: string | null
  vps_label: string | null
  positions_count: number
  /** Server tính (Rules FE mục 6): FE không tự suy ra từ last_seen_at. */
  online: boolean
}

export type LinkSummary = {
  id: number
  key_prefix: string
  status: LinkStatus
  created_at: number
  bound_at: number | null
  /** null = chưa gắn tài khoản MT5 (chưa có lần gửi nào). */
  account: LinkAccountView | null
  /** null = chưa nhận dữ liệu lần nào. */
  state: LinkStateView | null
}

export type LinkEventView = {
  id: number
  ts: number
  type: string
  detail: unknown
}

export type LinkDetail = LinkSummary & {
  positions: Position[]
  events: LinkEventView[]
}

export type LinkListResponse = { links: LinkSummary[] }

/** `api_key` chỉ xuất hiện đúng một lần, ở phản hồi tạo liên kết. */
export type CreateLinkResponse = { link: LinkSummary; api_key: string }
