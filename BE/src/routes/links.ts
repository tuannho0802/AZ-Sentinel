import {
  type CreateLinkResponse,
  createLinkRequestSchema,
  eaVersionAtLeast,
  LINK_STATUSES,
  type LinkDetail,
  type LinkEventView,
  type LinkListResponse,
  normalizeVpsName,
  positionSchema,
  setVpsNameSchema,
  TRADE,
  type TradeCommand,
  tradeRequestSchema,
} from '@az-sentinel/shared'
import { zValidator } from '@hono/zod-validator'
import { type Context, Hono } from 'hono'
import { z } from 'zod'
import { AppError, errorBody } from '../lib/app-error'
import { generateApiKey } from '../lib/crypto'
import { nowUnix } from '../lib/time'
import type { Viewer, ViewerAuth } from '../live/viewer-auth'
import {
  gatewayOnline,
  type LinkRow,
  loadLink,
  parseId,
  revokeAtHub,
  SELECT_LINK_OWNED,
  safeJson,
  sendTradeAtHub,
  toSummary,
} from '../services/link-view'
import type { AppEnv } from '../types'

const MAX_LINKS_USER = 20
const MAX_LINKS_ADMIN = 100
const LIST_LIMIT = 200
const EVENTS_LIMIT = 20

const isAdmin = (v: Viewer) => v.role === 'root_admin' || v.role === 'admin'

/** 16 ký tự hex ngẫu nhiên: định danh lệnh giao dịch (EA nhớ để không chạy lại). */
function newCmdId(): string {
  const b = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

const viewerOf = (c: Context<AppEnv>): Viewer => {
  const viewer = c.get('viewer')
  if (!viewer) throw new AppError(401, 'UNAUTHENTICATED', 'Chưa đăng nhập')
  return viewer
}

/**
 * Liên kết không tồn tại hoặc không thuộc quyền của người xem đều trả 404, không phân biệt
 * (không cho dò id của người khác). Admin xem và sửa được mọi liên kết.
 */
async function authorize(c: Context<AppEnv>, id: number): Promise<void> {
  const viewer = viewerOf(c)
  const row = await c.env.DB.prepare('SELECT owner_id FROM ea_links WHERE id = ?')
    .bind(id)
    .first<{ owner_id: number | null }>()
  if (!row || (!isAdmin(viewer) && row.owner_id !== viewer.userId)) {
    throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy liên kết')
  }
}

/**
 * Liên kết EA có phân quyền (Plan 4B), thay cho `/api/dev/links`:
 * - Người dùng thường chỉ thấy và sửa liên kết của mình; admin thấy tất cả (kèm chủ sở hữu).
 * - Liên kết tạo ở đây thuộc về người tạo; Gateway chỉ nối được khi token cùng chủ với liên kết.
 * Ghi bắt buộc JSON; phản hồi `no-store`. Khi đang dự phòng trên Cloudflare, thao tác ghi bị bộ định
 * tuyến biên chặn (chỉ xem) để hai cơ sở dữ liệu không lệch nhau.
 */
export function createLinkRoutes(viewerAuth: ViewerAuth) {
  const routes = new Hono<AppEnv>()

  routes.use('*', async (c, next) => {
    const viewer = await viewerAuth(c)
    if (!viewer) throw new AppError(401, 'UNAUTHENTICATED', 'Chưa đăng nhập')
    const method = c.req.method
    if (method !== 'GET' && method !== 'HEAD') {
      const type = c.req.header('Content-Type') ?? ''
      if (!type.toLowerCase().includes('application/json')) {
        throw new AppError(400, 'VALIDATION_FAILED', 'Cần Content-Type: application/json')
      }
    }
    c.set('viewer', viewer)
    c.header('Cache-Control', 'no-store')
    await next()
  })

  routes.get('/', async (c) => {
    const viewer = viewerOf(c)
    const stmt = isAdmin(viewer)
      ? c.env.DB.prepare(`${SELECT_LINK_OWNED} ORDER BY l.id DESC LIMIT ?`).bind(LIST_LIMIT)
      : c.env.DB.prepare(
          `${SELECT_LINK_OWNED} WHERE l.owner_id = ? ORDER BY l.id DESC LIMIT ?`,
        ).bind(viewer.userId, LIST_LIMIT)
    const { results } = await stmt.all<LinkRow>()
    const now = nowUnix()
    const viaGateway = await gatewayOnline(c.env)
    const body: LinkListResponse = { links: results.map((r) => toSummary(r, now, viaGateway)) }
    return c.json(body)
  })

  routes.post('/', async (c) => {
    const viewer = viewerOf(c)
    const cap = isAdmin(viewer) ? MAX_LINKS_ADMIN : MAX_LINKS_USER
    const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM ea_links WHERE owner_id = ?')
      .bind(viewer.userId)
      .first<{ n: number }>()
    if ((count?.n ?? 0) >= cap) {
      throw new AppError(400, 'VALIDATION_FAILED', `Đã đạt giới hạn ${cap} liên kết. Hãy xóa bớt.`)
    }
    // Thân rỗng hoặc không phải JSON: coi như không có tên VPS. Có nhưng sai kiểu thì 400.
    const raw: unknown = await c.req.json().catch(() => ({}))
    const parsed = createLinkRequestSchema.safeParse(raw ?? {})
    if (!parsed.success) throw new AppError(400, 'VALIDATION_FAILED', 'Tên VPS không hợp lệ')
    const { key, keyHash, keyPrefix } = await generateApiKey()
    const row = await c.env.DB.prepare(
      `INSERT INTO ea_links (key_hash, key_prefix, status, created_at, vps_name, owner_id)
       VALUES (?, ?, 'active', ?, ?, ?) RETURNING id`,
    )
      .bind(keyHash, keyPrefix, nowUnix(), normalizeVpsName(parsed.data.vps_name), viewer.userId)
      .first<{ id: number }>()
    if (!row) throw new AppError(500, 'INTERNAL', 'Lỗi hệ thống')
    const body: CreateLinkResponse = { link: await loadLink(c.env, row.id, true), api_key: key }
    return c.json(body, 201)
  })

  routes.get('/:id', async (c) => {
    const id = parseId(c.req.param('id'))
    await authorize(c, id)
    const link = await loadLink(c.env, id, true)
    const stateRow = await c.env.DB.prepare(
      'SELECT positions_json FROM link_state WHERE link_id = ?',
    )
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

  routes.post(
    '/:id/status',
    zValidator('json', z.object({ status: z.enum(LINK_STATUSES) }), (result, c) => {
      if (!result.success)
        return c.json(errorBody('VALIDATION_FAILED', 'Trạng thái không hợp lệ'), 400)
    }),
    async (c) => {
      const id = parseId(c.req.param('id'))
      await authorize(c, id)
      const { status } = c.req.valid('json')
      await c.env.DB.prepare('UPDATE ea_links SET status = ? WHERE id = ?').bind(status, id).run()
      if (status === 'disabled') await revokeAtHub(c.env, id)
      return c.json(await loadLink(c.env, id, true))
    },
  )

  routes.post(
    '/:id/vps-name',
    zValidator('json', setVpsNameSchema, (result, c) => {
      if (!result.success)
        return c.json(errorBody('VALIDATION_FAILED', 'Tên VPS không hợp lệ'), 400)
    }),
    async (c) => {
      const id = parseId(c.req.param('id'))
      await authorize(c, id)
      const vpsName = normalizeVpsName(c.req.valid('json').vps_name)
      await c.env.DB.prepare('UPDATE ea_links SET vps_name = ? WHERE id = ?')
        .bind(vpsName, id)
        .run()
      return c.json(await loadLink(c.env, id, true))
    },
  )

  /**
   * Bật/tắt giao dịch thủ công từ xa cho liên kết (v0.2.6). Chỉ admin. Mặc định tắt; gỡ gắn tài khoản cũng
   * tắt lại. Đây mới chỉ là một lớp: EA còn công tắc `InpAllowRemoteTrading` do chủ terminal tự bật.
   */
  routes.post(
    '/:id/trade-enabled',
    zValidator('json', z.object({ enabled: z.boolean() }), (result, c) => {
      if (!result.success)
        return c.json(errorBody('VALIDATION_FAILED', 'Giá trị không hợp lệ'), 400)
    }),
    async (c) => {
      const viewer = viewerOf(c)
      if (!isAdmin(viewer)) {
        throw new AppError(403, 'FORBIDDEN', 'Chỉ quản trị viên được bật giao dịch từ xa')
      }
      const id = parseId(c.req.param('id'))
      await authorize(c, id)
      await c.env.DB.prepare('UPDATE ea_links SET trade_enabled = ? WHERE id = ?')
        .bind(c.req.valid('json').enabled ? 1 : 0, id)
        .run()
      return c.json(await loadLink(c.env, id, true))
    },
  )

  /**
   * Giao dịch thủ công từ xa: đóng lệnh, đóng một phần, sửa SL/TP (v0.2.6). Trả 202 kèm `cmd_id`; kết quả
   * thật đến sau qua WebSocket (`trade_result`), không phải phản hồi này.
   *
   * Kiểm tra theo thứ tự: quyền admin, quyền với liên kết, hợp lệ thân lệnh, liên kết đang bật, đã bật
   * giao dịch, đã gắn tài khoản, lệnh trước đã xong. Mọi lệnh được ghi nhật ký TRƯỚC khi gửi.
   */
  routes.post('/:id/trade', async (c) => {
    const viewer = viewerOf(c)
    if (!isAdmin(viewer)) {
      throw new AppError(403, 'FORBIDDEN', 'Chỉ quản trị viên được giao dịch từ xa')
    }
    const id = parseId(c.req.param('id'))
    await authorize(c, id)
    const parsed = tradeRequestSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) throw new AppError(400, 'VALIDATION_FAILED', 'Lệnh giao dịch không hợp lệ')
    const req = parsed.data

    const link = await c.env.DB.prepare(
      `SELECT l.status, l.trade_enabled, l.login, s.ea_ver
       FROM ea_links l LEFT JOIN link_state s ON s.link_id = l.id WHERE l.id = ?`,
    )
      .bind(id)
      .first<{
        status: string
        trade_enabled: number
        login: number | null
        ea_ver: string | null
      }>()
    if (!link) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy liên kết')
    if (link.status !== 'active') throw new AppError(403, 'LINK_DISABLED', 'Liên kết đang tắt')
    if (link.trade_enabled !== 1) {
      throw new AppError(403, 'TRADE_DISABLED', 'Liên kết chưa bật giao dịch từ xa')
    }
    if (link.login === null) throw new AppError(409, 'CONFLICT', 'Liên kết chưa gắn tài khoản')
    // Phiên bản EA đã biết mà cũ hơn thì EA không hiểu lệnh: từ chối rõ ràng thay vì để chờ timeout.
    // Chưa biết phiên bản (null) thì cho qua, vì không có bằng chứng EA cũ.
    if (link.ea_ver !== null && !eaVersionAtLeast(link.ea_ver, TRADE.minEaVer)) {
      throw new AppError(
        409,
        'CONFLICT',
        `EA chưa hỗ trợ giao dịch từ xa (cần >= ${TRADE.minEaVer})`,
      )
    }

    const now = nowUnix()
    const pending = await c.env.DB.prepare(
      "SELECT 1 AS x FROM trade_log WHERE link_id = ? AND status = 'sent' AND created_at > ? LIMIT 1",
    )
      .bind(id, now - TRADE.busySec)
      .first()
    if (pending) {
      throw new AppError(409, 'TRADE_BUSY', 'Lệnh trước chưa xong, chờ vài giây rồi thử lại')
    }

    const cmdId = newCmdId()
    await c.env.DB.prepare(
      `INSERT INTO trade_log (link_id, user_id, cmd_id, op, ticket, volume, sl, tp, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'sent', ?)`,
    )
      .bind(
        id,
        viewer.userId,
        cmdId,
        req.op,
        req.ticket,
        req.op === 'partial_close' ? req.volume : null,
        req.op === 'modify' ? req.sl : null,
        req.op === 'modify' ? req.tp : null,
        now,
      )
      .run()

    const cmd: TradeCommand = { cmd_id: cmdId, ...req }
    const r = await sendTradeAtHub(c.env, id, cmd)
    if (!r.sent) {
      await c.env.DB.prepare(
        `UPDATE trade_log SET status = 'failed', reason = 'terminal_offline', code = 0, finished_at = ?
         WHERE cmd_id = ?`,
      )
        .bind(nowUnix(), cmdId)
        .run()
      throw new AppError(409, 'TRADE_BUSY', 'Terminal đang offline, chưa gửi được lệnh')
    }
    return c.json({ cmd_id: cmdId, op: req.op, ticket: req.ticket }, 202)
  })

  /** Cấp lại khóa: khóa cũ vô hiệu ngay, giữ nguyên tài khoản đã gắn. Khóa mới chỉ trả ở phản hồi này. */
  routes.post('/:id/rotate-key', async (c) => {
    const id = parseId(c.req.param('id'))
    await authorize(c, id)
    const { key, keyHash, keyPrefix } = await generateApiKey()
    await c.env.DB.prepare('UPDATE ea_links SET key_hash = ?, key_prefix = ? WHERE id = ?')
      .bind(keyHash, keyPrefix, id)
      .run()
    await revokeAtHub(c.env, id)
    const body: CreateLinkResponse = { link: await loadLink(c.env, id, true), api_key: key }
    return c.json(body)
  })

  /** Gỡ gắn tài khoản MT5 (xóa luôn số liệu của nó) để gắn lại với tài khoản khác. */
  routes.post('/:id/unbind', async (c) => {
    const id = parseId(c.req.param('id'))
    await authorize(c, id)
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE ea_links SET login = NULL, server = NULL, broker = NULL, name = NULL,
           currency = NULL, mode = NULL, bound_at = NULL, trade_enabled = 0 WHERE id = ?`,
      ).bind(id),
      c.env.DB.prepare('DELETE FROM link_state WHERE link_id = ?').bind(id),
      c.env.DB.prepare('DELETE FROM equity_m5 WHERE link_id = ?').bind(id),
      c.env.DB.prepare('DELETE FROM trades WHERE link_id = ?').bind(id),
      c.env.DB.prepare('DELETE FROM events WHERE link_id = ?').bind(id),
    ])
    await revokeAtHub(c.env, id)
    return c.json(await loadLink(c.env, id, true))
  })

  routes.delete('/:id', async (c) => {
    const id = parseId(c.req.param('id'))
    await authorize(c, id)
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

  return routes
}
