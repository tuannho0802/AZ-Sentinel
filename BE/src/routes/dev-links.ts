import {
  type CreateLinkResponse,
  createLinkRequestSchema,
  LINK_ONLINE_THRESHOLD_SECONDS,
  LINK_STATUSES,
  type LinkDetail,
  type LinkEventView,
  type LinkListResponse,
  type LinkStatus,
  type LinkSummary,
  normalizeVpsName,
  positionSchema,
  setVpsNameSchema,
} from '@az-sentinel/shared'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { AppError, errorBody } from '../lib/app-error'
import { generateApiKey } from '../lib/crypto'
import { nowUnix } from '../lib/time'
import { HUB_NAME } from '../live/routes/live-ws'
import type { AppEnv, Bindings } from '../types'

/**
 * DEV (Part 1): quản lý liên kết EA để thử bằng giao diện, KHÔNG CÓ XÁC THỰC.
 * Chỉ hoạt động khi biến DEV_LINKS_API=1 (truyền bằng `wrangler dev --var`, có trong script
 * `dev` của BE). Không có biến thì mọi đường dẫn trả 404 như chưa từng tồn tại.
 * Part 2/3 thay bằng API có phân quyền; XÓA tệp này và dòng đăng ký trong app.ts.
 */
export const devLinks = new Hono<AppEnv>()

const MAX_DEV_LINKS = 20
const EVENTS_LIMIT = 20

devLinks.use('*', async (c, next) => {
  if (c.env.DEV_LINKS_API !== '1') {
    return c.json(errorBody('NOT_FOUND', 'Không tìm thấy'), 404)
  }
  // Thao tác ghi bắt buộc JSON: trình duyệt của trang khác không gửi được kiểu này mà
  // không qua preflight (BE không bật CORS), nên không thể kích hoạt từ trang web lạ.
  const method = c.req.method
  if (method !== 'GET' && method !== 'HEAD') {
    const type = c.req.header('Content-Type') ?? ''
    if (!type.toLowerCase().includes('application/json')) {
      throw new AppError(400, 'VALIDATION_FAILED', 'Cần Content-Type: application/json')
    }
  }
  await next()
})

type LinkRow = {
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
}

const SELECT_LINK = `
  SELECT l.id, l.key_prefix, l.status, l.created_at, l.bound_at, l.vps_name,
         l.login, l.server, l.broker, l.name, l.currency, l.mode,
         s.balance, s.equity, s.margin, s.margin_free, s.margin_level, s.floating_pl,
         s.last_reason, s.last_seen_at, s.last_seq, s.ea_ver, s.vps_label,
         json_array_length(COALESCE(s.positions_json, '[]')) AS positions_count,
         s.presence
  FROM ea_links l LEFT JOIN link_state s ON s.link_id = l.id`

/**
 * Liên kết đang online qua Gateway (hub biết từ WebSocket). Hub lỗi thì coi là rỗng: danh sách
 * vẫn hiển thị theo `last_seen_at` của đường trực tiếp.
 */
async function gatewayOnline(env: Bindings): Promise<Set<number>> {
  try {
    const ids = await env.LIVE_HUB.getByName(HUB_NAME).onlineLinkIds(Date.now())
    return new Set(ids)
  } catch {
    return new Set()
  }
}

/** Báo hub thu hồi liên kết (khóa bị khóa, cấp lại, gỡ gắn, xóa). Lỗi hub không chặn thao tác. */
async function revokeAtHub(env: Bindings, linkId: number): Promise<void> {
  try {
    await env.LIVE_HUB.getByName(HUB_NAME).revokeLink(linkId)
  } catch {
    // hub không sẵn sàng: Gateway sẽ bị từ chối ở lần bind kế tiếp
  }
}

function toSummary(r: LinkRow, now: number, viaGateway: Set<number>): LinkSummary {
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

function parseId(raw: string): number {
  if (!/^[1-9][0-9]{0,9}$/.test(raw)) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy')
  return Number(raw)
}

async function loadLink(env: Bindings, id: number): Promise<LinkSummary> {
  const row = await env.DB.prepare(`${SELECT_LINK} WHERE l.id = ?`).bind(id).first<LinkRow>()
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy liên kết')
  return toSummary(row, nowUnix(), await gatewayOnline(env))
}

function safeJson(text: string | null): unknown {
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

devLinks.get('/links', async (c) => {
  const { results } = await c.env.DB.prepare(
    `${SELECT_LINK} ORDER BY l.id DESC LIMIT 100`,
  ).all<LinkRow>()
  const now = nowUnix()
  const viaGateway = await gatewayOnline(c.env)
  const body: LinkListResponse = { links: results.map((r) => toSummary(r, now, viaGateway)) }
  return c.json(body)
})

devLinks.post('/links', async (c) => {
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM ea_links').first<{ n: number }>()
  if ((count?.n ?? 0) >= MAX_DEV_LINKS) {
    throw new AppError(
      400,
      'VALIDATION_FAILED',
      `Đã đạt giới hạn ${MAX_DEV_LINKS} liên kết (chế độ thử). Hãy xóa bớt.`,
    )
  }
  // Thân yêu cầu có thể rỗng hoặc không phải JSON: coi như không có tên VPS. Có nhưng sai kiểu thì 400.
  const raw: unknown = await c.req.json().catch(() => ({}))
  const parsed = createLinkRequestSchema.safeParse(raw ?? {})
  if (!parsed.success) throw new AppError(400, 'VALIDATION_FAILED', 'Tên VPS không hợp lệ')
  const vpsName = normalizeVpsName(parsed.data.vps_name)
  const { key, keyHash, keyPrefix } = await generateApiKey()
  const row = await c.env.DB.prepare(
    `INSERT INTO ea_links (key_hash, key_prefix, status, created_at, vps_name)
     VALUES (?, ?, 'active', ?, ?) RETURNING id`,
  )
    .bind(keyHash, keyPrefix, nowUnix(), vpsName)
    .first<{ id: number }>()
  if (!row) throw new AppError(500, 'INTERNAL', 'Lỗi hệ thống')
  const body: CreateLinkResponse = { link: await loadLink(c.env, row.id), api_key: key }
  c.header('Cache-Control', 'no-store')
  return c.json(body, 201)
})

devLinks.get('/links/:id', async (c) => {
  const id = parseId(c.req.param('id'))
  const link = await loadLink(c.env, id)
  const stateRow = await c.env.DB.prepare('SELECT positions_json FROM link_state WHERE link_id = ?')
    .bind(id)
    .first<{ positions_json: string | null }>()
  const parsed = z.array(positionSchema).safeParse(safeJson(stateRow?.positions_json ?? null))
  const { results } = await c.env.DB.prepare(
    'SELECT id, ts, type, detail_json FROM events WHERE link_id = ? ORDER BY ts DESC, id DESC LIMIT ?',
  )
    .bind(id, EVENTS_LIMIT)
    .all<{ id: number; ts: number; type: string; detail_json: string | null }>()
  const events: LinkEventView[] = results.map((e) => ({
    id: e.id,
    ts: e.ts,
    type: e.type,
    detail: safeJson(e.detail_json),
  }))
  const body: LinkDetail = { ...link, positions: parsed.success ? parsed.data : [], events }
  return c.json(body)
})

devLinks.post(
  '/links/:id/status',
  zValidator('json', z.object({ status: z.enum(LINK_STATUSES) }), (result, c) => {
    if (!result.success)
      return c.json(errorBody('VALIDATION_FAILED', 'Trạng thái không hợp lệ'), 400)
  }),
  async (c) => {
    const id = parseId(c.req.param('id'))
    const { status } = c.req.valid('json')
    const res = await c.env.DB.prepare('UPDATE ea_links SET status = ? WHERE id = ?')
      .bind(status, id)
      .run()
    if (res.meta.changes === 0) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy liên kết')
    if (status === 'disabled') await revokeAtHub(c.env, id)
    return c.json(await loadLink(c.env, id))
  },
)

/** Đặt hoặc đổi tên VPS (người dùng tự nhập). Rỗng/null = xóa tên. Không đụng tới khóa hay Gateway. */
devLinks.post(
  '/links/:id/vps-name',
  zValidator('json', setVpsNameSchema, (result, c) => {
    if (!result.success) return c.json(errorBody('VALIDATION_FAILED', 'Tên VPS không hợp lệ'), 400)
  }),
  async (c) => {
    const id = parseId(c.req.param('id'))
    const vpsName = normalizeVpsName(c.req.valid('json').vps_name)
    const res = await c.env.DB.prepare('UPDATE ea_links SET vps_name = ? WHERE id = ?')
      .bind(vpsName, id)
      .run()
    if (res.meta.changes === 0) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy liên kết')
    return c.json(await loadLink(c.env, id))
  },
)

/**
 * Cấp lại khóa: sinh khóa mới, khóa cũ vô hiệu ngay. Giữ nguyên tài khoản đã gắn.
 * (DB chỉ lưu băm nên không thể lấy lại khóa cũ.) Khóa mới chỉ trả ở phản hồi này.
 */
devLinks.post('/links/:id/rotate-key', async (c) => {
  const id = parseId(c.req.param('id'))
  await loadLink(c.env, id)
  const { key, keyHash, keyPrefix } = await generateApiKey()
  await c.env.DB.prepare('UPDATE ea_links SET key_hash = ?, key_prefix = ? WHERE id = ?')
    .bind(keyHash, keyPrefix, id)
    .run()
  await revokeAtHub(c.env, id)
  const body: CreateLinkResponse = { link: await loadLink(c.env, id), api_key: key }
  c.header('Cache-Control', 'no-store')
  return c.json(body)
})

/** Gỡ gắn tài khoản để thử lại luồng "đăng ký lần đầu" (kể cả với tài khoản MT5 khác). */
devLinks.post('/links/:id/unbind', async (c) => {
  const id = parseId(c.req.param('id'))
  await loadLink(c.env, id)
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE ea_links SET login = NULL, server = NULL, broker = NULL, name = NULL,
         currency = NULL, mode = NULL, bound_at = NULL WHERE id = ?`,
    ).bind(id),
    c.env.DB.prepare('DELETE FROM link_state WHERE link_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM equity_m5 WHERE link_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM trades WHERE link_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM events WHERE link_id = ?').bind(id),
  ])
  await revokeAtHub(c.env, id)
  return c.json(await loadLink(c.env, id))
})

devLinks.delete('/links/:id', async (c) => {
  const id = parseId(c.req.param('id'))
  await loadLink(c.env, id)
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM link_state WHERE link_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM equity_m5 WHERE link_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM trades WHERE link_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM events WHERE link_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM ea_links WHERE id = ?').bind(id),
  ])
  await revokeAtHub(c.env, id)
  return c.body(null, 204)
})
