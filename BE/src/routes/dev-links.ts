import {
  type CreateLinkResponse,
  createLinkRequestSchema,
  LINK_STATUSES,
  type LinkDetail,
  type LinkEventView,
  type LinkListResponse,
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
import {
  gatewayOnline,
  type LinkRow,
  loadLink,
  parseId,
  revokeAtHub,
  SELECT_LINK,
  safeJson,
  toSummary,
} from '../services/link-view'
import type { AppEnv } from '../types'

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
