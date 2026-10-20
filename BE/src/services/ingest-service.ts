import { type IngestPayload, type IngestResponse, normalizeVpsLabel } from '@az-sentinel/shared'
import {
  bindLinkStmt,
  findLinkByKeyHash,
  insertAuthFailEventStmt,
  insertEquityM5Stmt,
  insertOnlineEventStmt,
  type LinkRow,
  upsertLinkStateStmt,
  upsertTradeStmt,
} from '../db/sql'
import { AppError } from '../lib/app-error'
import { barTimestamp } from '../lib/time'

export type IngestInput = {
  db: D1Database
  keyHash: string
  payload: IngestPayload
  ip: string | null
  now: number
  /** true = trả meta rows_written/rows_read (dev/spike). */
  debugMeta: boolean
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message)
}

export function sumMeta(results: { meta: { rows_written: number; rows_read: number } }[]) {
  return results.reduce(
    (acc, r) => ({
      rows_written: acc.rows_written + r.meta.rows_written,
      rows_read: acc.rows_read + r.meta.rows_read,
    }),
    { rows_written: 0, rows_read: 0 },
  )
}

/** Bản ghi trùng: cùng phiên (sid) và seq không tăng. Phiên mới (sid khác) luôn hợp lệ. */
export function isDuplicate(link: LinkRow, payload: IngestPayload): boolean {
  return (
    link.last_sid !== null &&
    link.last_seq !== null &&
    link.last_sid === payload.sid &&
    payload.seq <= link.last_seq
  )
}

async function rejectWith(
  input: IngestInput,
  link: LinkRow,
  reason: string,
  error: AppError,
): Promise<never> {
  const { db, payload, now } = input
  try {
    await insertAuthFailEventStmt(db, link.id, now, {
      reason,
      server: payload.account.server,
      login: payload.account.login,
    }).run()
  } catch {
    // Ghi sự kiện chỉ là phụ; lỗi D1 ở đây không được che mất lỗi xác thực gốc.
  }
  throw error
}

/**
 * Luồng ingest theo Plan 2 mục 6 (sau bước kiểm tra body và zod ở route):
 * tra khóa -> kiểm tra trạng thái và (server, login) -> loại trùng -> một DB.batch().
 */
export async function ingest(input: IngestInput): Promise<IngestResponse> {
  const { db, payload, now } = input

  const link = await findLinkByKeyHash(db, input.keyHash)
  if (!link) throw new AppError(401, 'INVALID_API_KEY', 'API key không hợp lệ')
  if (link.status !== 'active') {
    throw new AppError(403, 'LINK_DISABLED', 'Liên kết EA đã bị khóa')
  }

  const account = payload.account
  const firstBind = link.login === null
  if (!firstBind && (link.login !== account.login || link.server !== account.server)) {
    return rejectWith(
      input,
      link,
      'account_mismatch',
      new AppError(
        409,
        'LINK_BOUND_TO_OTHER_ACCOUNT',
        'API key đã gắn với tài khoản giao dịch khác',
      ),
    )
  }

  if (isDuplicate(link, payload)) {
    return { ack_seq: link.last_seq ?? payload.seq, commands: [], duplicate: true }
  }

  const statements: D1PreparedStatement[] = []
  if (firstBind) statements.push(bindLinkStmt(db, link.id, account, now))
  statements.push(
    upsertLinkStateStmt(db, {
      linkId: link.id,
      payload,
      vpsLabel: normalizeVpsLabel(payload.vps),
      ip: input.ip,
      now,
    }),
  )
  if (payload.reason.includes('m5_bar')) {
    statements.push(insertEquityM5Stmt(db, link.id, barTimestamp(payload.ts_utc, now), account))
  }
  for (const event of payload.events) statements.push(upsertTradeStmt(db, link.id, event))
  if (link.presence === 1) statements.push(insertOnlineEventStmt(db, link.id, now))

  let results: Awaited<ReturnType<D1Database['batch']>>
  try {
    results = await db.batch(statements)
  } catch (error) {
    if (firstBind && isUniqueViolation(error)) {
      return rejectWith(
        input,
        link,
        'bound_elsewhere',
        new AppError(
          409,
          'LINK_BOUND_TO_OTHER_ACCOUNT',
          'Tài khoản giao dịch này đã được liên kết với API key khác',
        ),
      )
    }
    // D1 lỗi: 503 để EA giữ hàng đợi và gửi lại (Rules BE mục 7).
    throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Dịch vụ tạm thời không khả dụng')
  }

  const response: IngestResponse = { ack_seq: payload.seq, commands: [] }
  if (input.debugMeta) response.meta = sumMeta(results)
  return response
}
