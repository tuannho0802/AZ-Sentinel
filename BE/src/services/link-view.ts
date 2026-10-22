import {
  LINK_ONLINE_THRESHOLD_SECONDS,
  type LinkStatus,
  type LinkSummary,
} from '@az-sentinel/shared'
import { AppError } from '../lib/app-error'
import { nowUnix } from '../lib/time'
import { HUB_NAME } from '../live/routes/live-ws'
import type { Bindings } from '../types'

/** Truy vấn và chuyển đổi dòng liên kết dùng chung cho API dev và API có phân quyền. */

export type LinkRow = {
  id: number
  key_prefix: string
  status: LinkStatus
  created_at: number
  bound_at: number | null
  vps_name: string | null
  login: number | null
  server: string | null
  broker: string | null
  name: string | null
  currency: string | null
  mode: string | null
  balance: number | null
  equity: number | null
  margin: number | null
  margin_free: number | null
  margin_level: number | null
  floating_pl: number | null
  last_reason: string | null
  last_seen_at: number | null
  last_seq: number | null
  ea_ver: string | null
  vps_label: string | null
  positions_count: number | null
  presence: number | null
  /** Chỉ có khi truy vấn kèm chủ sở hữu (`SELECT_LINK_OWNED`). */
  owner_id?: number | null
  owner_name?: string | null
}

const LINK_FROM = `
  FROM ea_links l LEFT JOIN link_state s ON s.link_id = l.id`

const LINK_FIELDS = `
  l.id, l.key_prefix, l.status, l.created_at, l.bound_at, l.vps_name,
         l.login, l.server, l.broker, l.name, l.currency, l.mode,
         s.balance, s.equity, s.margin, s.margin_free, s.margin_level, s.floating_pl,
         s.last_reason, s.last_seen_at, s.last_seq, s.ea_ver, s.vps_label,
         json_array_length(COALESCE(s.positions_json, '[]')) AS positions_count,
         s.presence`

export const SELECT_LINK = `SELECT ${LINK_FIELDS}${LINK_FROM}`

/** Như `SELECT_LINK` nhưng kèm chủ sở hữu (tên lấy từ `users`), cho API có phân quyền. */
export const SELECT_LINK_OWNED = `SELECT ${LINK_FIELDS}, l.owner_id, u.display_name AS owner_name${LINK_FROM}
  LEFT JOIN users u ON u.id = l.owner_id`

/**
 * Liên kết đang online qua Gateway (hub biết từ WebSocket). Hub lỗi thì coi là rỗng: danh sách
 * vẫn hiển thị theo `last_seen_at` của đường trực tiếp.
 */
export async function gatewayOnline(env: Bindings): Promise<Set<number>> {
  try {
    const ids = await env.LIVE_HUB.getByName(HUB_NAME).onlineLinkIds(Date.now())
    return new Set(ids)
  } catch {
    return new Set()
  }
}

/** Báo hub thu hồi liên kết (khóa bị khóa, cấp lại, gỡ gắn, xóa). Lỗi hub không chặn thao tác. */
export async function revokeAtHub(env: Bindings, linkId: number): Promise<void> {
  try {
    await env.LIVE_HUB.getByName(HUB_NAME).revokeLink(linkId)
  } catch {
    // hub không sẵn sàng: Gateway sẽ bị từ chối ở lần bind kế tiếp
  }
}

function ownerOf(r: LinkRow): { id: number; name: string | null } | null {
  return r.owner_id === null || r.owner_id === undefined
    ? null
    : { id: r.owner_id, name: r.owner_name ?? null }
}

export function toSummary(r: LinkRow, now: number, viaGateway: Set<number>): LinkSummary {
  return {
    id: r.id,
    key_prefix: r.key_prefix,
    status: r.status,
    created_at: r.created_at,
    bound_at: r.bound_at,
    vps_name: r.vps_name,
    account:
      r.login !== null && r.server !== null
        ? {
            login: r.login,
            server: r.server,
            broker: r.broker,
            name: r.name,
            currency: r.currency,
            mode: r.mode,
          }
        : null,
    ...('owner_id' in r ? { owner: ownerOf(r) } : {}),
    state:
      r.last_seen_at === null
        ? null
        : {
            balance: r.balance,
            equity: r.equity,
            margin: r.margin,
            margin_free: r.margin_free,
            margin_level: r.margin_level,
            floating_pl: r.floating_pl,
            last_reason: r.last_reason,
            last_seen_at: r.last_seen_at,
            last_seq: r.last_seq,
            ea_ver: r.ea_ver,
            vps_label: r.vps_label,
            positions_count: r.positions_count ?? 0,
            // Gateway: online theo WebSocket. Đường trực tiếp: theo last_seen_at, trừ khi đã
            // bị đánh dấu offline (presence = 1).
            online:
              viaGateway.has(r.id) ||
              (r.presence !== 1 && now - r.last_seen_at <= LINK_ONLINE_THRESHOLD_SECONDS),
          },
  }
}

export function parseId(raw: string): number {
  if (!/^[1-9][0-9]{0,9}$/.test(raw)) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy')
  return Number(raw)
}

export async function loadLink(env: Bindings, id: number, owned = false): Promise<LinkSummary> {
  const select = owned ? SELECT_LINK_OWNED : SELECT_LINK
  const row = await env.DB.prepare(`${select} WHERE l.id = ?`).bind(id).first<LinkRow>()
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy liên kết')
  return toSummary(row, nowUnix(), await gatewayOnline(env))
}

export function safeJson(text: string | null): unknown {
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
