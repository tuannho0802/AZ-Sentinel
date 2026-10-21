import {
  clampIntervalSec,
  clampPollSec,
  type GateResponse,
  type IngestResponse,
  LIVE,
  normalizeVpsLabel,
  type Sample,
} from '@az-sentinel/shared'
import {
  bindLinkStmt,
  findLinkByKeyHash,
  insertEquityBarStmt,
  insertEquityM5Stmt,
  insertOnlineEventStmt,
  type LinkRow,
  touchLinkSeenStmt,
  upsertLinkStateStmt,
  upsertTradeStmt,
} from '../db/sql'
import { AppError } from '../lib/app-error'
import { m5Slot } from '../lib/time'
import type { HubClient, PublishResult } from '../live/hub-types'
import { type AuthInput, authorizeLink, failBatch, sumMeta } from './ingest-service'

/** Hub quá chậm thì coi như lỗi (fail-closed): EA ngừng gửi, không bao giờ gửi thêm. */
export const HUB_TIMEOUT_MS = 1500
const MAX_BAR_AGE_SEC = 7 * 24 * 3600

export type LiveConfig = { intervalSec: number; pollSec: number }

/** Đọc cấu hình từ biến môi trường, luôn kẹp vào biên an toàn (B-17). */
export function liveConfig(env: {
  LIVE_INTERVAL_SEC?: string
  GATE_POLL_SEC?: string
}): LiveConfig {
  const num = (v: string | undefined) => (v === undefined || v === '' ? undefined : Number(v))
  return {
    intervalSec: clampIntervalSec(num(env.LIVE_INTERVAL_SEC)),
    pollSec: clampPollSec(num(env.GATE_POLL_SEC)),
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('hub_timeout')), ms)
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}

function gateBody(mode: 'live' | 'idle', cfg: LiveConfig, now: number): GateResponse {
  return {
    mode,
    interval_sec: cfg.intervalSec,
    lease_sec: LIVE.leaseSec,
    next_poll_sec: cfg.pollSec,
    server_time: now,
  }
}

export type GateInput = {
  db: D1Database
  hub: HubClient
  keyHash: string
  now: number
  cfg: LiveConfig
  debugMeta: boolean
}

/**
 * `GET /api/ea/v1/gate`. Đọc D1 ~3 dòng (tra khóa). Ghi 0 dòng; tối đa 1 dòng mỗi 240 giây
 * (`last_seen_at`), thêm 1 dòng sự kiện `online` khi `presence = 1`. Hub lỗi => `idle`.
 */
export async function gate(input: GateInput): Promise<GateResponse & { meta?: object }> {
  const { db, now, cfg } = input
  const link = await findLinkByKeyHash(db, input.keyHash)
  if (!link) throw new AppError(401, 'INVALID_API_KEY', 'API key không hợp lệ')
  if (link.status !== 'active') throw new AppError(403, 'LINK_DISABLED', 'Liên kết EA đã bị khóa')

  let wanted = false
  try {
    const res = await withTimeout(
      input.hub.shouldBeLive({ linkId: link.id, ownerId: link.owner_id }, now * 1000),
      HUB_TIMEOUT_MS,
    )
    wanted = res.wanted
  } catch {
    wanted = false // fail-closed
  }

  // Chưa có dòng link_state (EA chưa từng ingest) thì không có gì để cập nhật.
  let meta: object | undefined
  if (link.last_seen_at !== null) {
    const stale = now - link.last_seen_at >= LIVE.idleTouchSec
    if (stale || link.presence === 1) {
      const stmts = [touchLinkSeenStmt(db, link.id, now)]
      if (link.presence === 1) stmts.push(insertOnlineEventStmt(db, link.id, now))
      try {
        const results = await db.batch(stmts)
        if (input.debugMeta) meta = sumMeta(results)
      } catch {
        // Ghi nhịp sống thất bại không được làm hỏng gate; lần sau thử lại.
      }
    }
  }
  const body = gateBody(wanted ? 'live' : 'idle', cfg, now)
  return meta ? { ...body, meta } : body
}

/** Hai mẫu giống hệt nhau (cùng giây và cùng giá trị): bản gửi lại, không phải tick mới. */
export function sameSample(a: Sample, b: Sample | null): boolean {
  return (
    b !== null &&
    a.t === b.t &&
    a.eq === b.eq &&
    a.bal === b.bal &&
    a.fl === b.fl &&
    (a.ml ?? null) === (b.ml ?? null)
  )
}

/**
 * Mẫu đáng tin: `t` lệch quá 120 giây so với giờ nhận thì dùng giờ nhận. `t` là Unix giây nên nhiều
 * tick có thể cùng giây: cho phép `t` bằng nhau nếu giá trị khác; bỏ mẫu lùi về trước và bản trùng.
 */
export function normalizeSamples(samples: Sample[], now: number): Sample[] {
  const out: Sample[] = []
  for (const s of samples) {
    const t = Math.abs(s.t - now) > LIVE.sampleSkewSec ? now : s.t
    const next = { ...s, t }
    const prev = out.at(-1) ?? null
    if (prev !== null && (t < prev.t || sameSample(next, prev))) continue
    out.push(next)
  }
  return out
}

export type LiveIngestInput = AuthInput & {
  hub: HubClient
  ip: string | null
  nowMs: number
  cfg: LiveConfig
  debugMeta: boolean
}

const NO_HUB: PublishResult = {
  wanted: false,
  duplicate: false,
  rateLimited: false,
  retryAfterSec: 0,
  barDue: false,
  posChanged: false,
}

/**
 * Ingest `live`/`backfill` (Plan 3B mục 7). Mẫu đi thẳng tới trình duyệt qua hub, KHÔNG ghi D1.
 * Dòng ghi dự kiến: link_state tối đa 1 lần/60 giây (hoặc khi lệnh đổi / có sự kiện giao dịch),
 * 1 dòng equity_m5 mỗi nến M5 (server chọn), mỗi sự kiện giao dịch 1 dòng, mỗi nến backfill
 * 0-1 dòng (tối đa 288). Không thêm chỉ mục. Tất cả trong một DB.batch().
 */
export async function ingestLive(input: LiveIngestInput): Promise<IngestResponse> {
  const { db, payload, now, cfg } = input
  const { link, firstBind } = await authorizeLink(input)

  const samples = normalizeSamples(payload.samples ?? [], now)
  let decision = NO_HUB
  try {
    decision = await withTimeout(
      input.hub.publish({
        ref: { linkId: link.id, ownerId: link.owner_id },
        sid: payload.sid,
        seq: payload.seq,
        samples,
        ...(payload.positions !== undefined ? { positions: payload.positions } : {}),
        ...(payload.pos_hash !== undefined ? { posHash: payload.pos_hash } : {}),
        nowMs: input.nowMs,
      }),
      HUB_TIMEOUT_MS,
    )
  } catch {
    decision = NO_HUB // fail-closed: EA nhận idle, sự kiện giao dịch vẫn được ghi bên dưới
  }

  if (decision.rateLimited) {
    throw new AppError(
      429,
      'RATE_LIMITED',
      'Gửi quá nhanh',
      decision.retryAfterSec || LIVE.minIngestGapSec,
    )
  }
  const base = (mode: 'live' | 'idle') => ({
    ack_seq: payload.seq,
    commands: [] as IngestResponse['commands'],
    ...gateBody(mode, cfg, now),
  })
  if (decision.duplicate) return { ...base('live'), duplicate: true }

  const statements: D1PreparedStatement[] = []
  const events = payload.events
  const stateDue =
    firstBind ||
    link.last_seen_at === null ||
    link.presence === 1 ||
    now - link.last_seen_at >= LIVE.stateWriteSec ||
    decision.posChanged ||
    events.length > 0
  if (firstBind) statements.push(bindLinkStmt(db, link.id, payload.account, now))
  if (stateDue) {
    statements.push(
      upsertLinkStateStmt(db, {
        linkId: link.id,
        payload,
        vpsLabel: normalizeVpsLabel(payload.vps),
        ip: input.ip,
        now,
      }),
    )
  }
  // Nến M5 do SERVER chọn theo giờ nhận (không tin `t` của EA).
  if (decision.barDue) {
    statements.push(insertEquityM5Stmt(db, link.id, m5Slot(now), payload.account))
  }
  if (payload.reason.includes('backfill') && payload.bars) {
    const seen = new Set<number>()
    for (const bar of payload.bars) {
      const ts = m5Slot(bar.t)
      if (ts < now - MAX_BAR_AGE_SEC || ts > now || seen.has(ts)) continue
      seen.add(ts)
      statements.push(insertEquityBarStmt(db, link.id, ts, bar))
    }
  }
  for (const event of events) statements.push(upsertTradeStmt(db, link.id, event))
  if (link.presence === 1) statements.push(insertOnlineEventStmt(db, link.id, now))

  let rows: ReturnType<typeof sumMeta> = { rows_written: 0, rows_read: 0 }
  if (statements.length > 0) {
    try {
      rows = sumMeta(await db.batch(statements))
    } catch (error) {
      return failBatch(input, link as LinkRow, firstBind, error)
    }
  }
  const response: IngestResponse = base(decision.wanted ? 'live' : 'idle')
  if (input.debugMeta) response.meta = rows
  return response
}
