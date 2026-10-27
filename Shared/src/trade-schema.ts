import { z } from 'zod'

/**
 * Giao dịch thủ công từ xa (v0.2.6, Pha 1): đóng lệnh, đóng một phần, sửa SL/TP.
 *
 * Đường đi: FE -> `POST /api/links/:id/trade` -> hub -> Gateway (WebSocket `trade`) -> EA (nằm trong
 * phản hồi `/v1/ping` hoặc `/v1/samples`) -> EA thực thi -> `POST /v1/trade_result` -> Gateway -> hub
 * -> người xem (`trade_result`). Mỗi terminal chỉ có MỘT lệnh đang chờ tại một thời điểm.
 *
 * An toàn: EA có công tắc `InpAllowRemoteTrading` (mặc định tắt), lệnh có `cmd_id` duy nhất và hạn
 * dùng ngắn, EA nhớ `cmd_id` đã chạy để không chạy lại khi bị gửi trùng hay khởi động lại.
 */
export const TRADE_OPS = ['close', 'partial_close', 'modify'] as const
export type TradeOp = (typeof TRADE_OPS)[number]

export const TRADE = {
  /** Hạn dùng của lệnh tính từ lúc Gateway nhận (ms). */
  ttlMs: 15_000,
  /** EA chỉ BẮT ĐẦU thực thi khi hạn còn ít nhất chừng này (ms), chừa thời gian cho sàn phản hồi. */
  minStartMs: 3_000,
  /** Quá hạn mà EA vẫn im thì Gateway báo `timeout` sau chừng này (ms) để không báo sai khi EA đang chạy dở. */
  graceMs: 8_000,
  /** Phiên bản EA tối thiểu hiểu lệnh giao dịch (so sánh theo số). */
  minEaVer: '0.5.0',
  maxVolume: 1000,
  /** Server từ chối lệnh mới nếu lệnh trước của liên kết còn `sent` chưa quá chừng này (giây). */
  busySec: 25,
} as const

/** `cmd_id`: 16 ký tự hex do server sinh, EA và Gateway coi là chuỗi mờ. */
export const CMD_ID = /^[0-9a-f]{16}$/
const cmdId = z.string().regex(CMD_ID)

const ticket = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
/** Giá SL/TP; 0 = không đặt (bỏ). */
const price = z.number().finite().nonnegative().max(1e9)

/** Thân `POST /api/links/:id/trade`. */
export const tradeRequestSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('close'), ticket }),
  z.object({
    op: z.literal('partial_close'),
    ticket,
    volume: z.number().finite().positive().max(TRADE.maxVolume),
  }),
  z.object({ op: z.literal('modify'), ticket, sl: price, tp: price }),
])
export type TradeRequest = z.infer<typeof tradeRequestSchema>

export const TRADE_STATUSES = ['sent', 'done', 'failed', 'timeout'] as const
export type TradeStatus = (typeof TRADE_STATUSES)[number]

/**
 * Lý do thất bại do EA/Gateway tự đặt (máy đọc). `retcode` nghĩa là sàn từ chối: xem `code`
 * (retcode của MT5) và `detail`.
 */
export const TRADE_REASONS = [
  'ok',
  'remote_disabled',
  'terminal_offline',
  'busy',
  'expired',
  'no_position',
  'bad_volume',
  'bad_stops',
  'bad_request',
  'algo_off',
  'market_closed',
  'retcode',
  'no_reply',
] as const
export type TradeReason = (typeof TRADE_REASONS)[number]

const shortText = (max: number) => z.string().max(max)

/** Kết quả EA báo (qua Gateway). `detail` là mô tả ASCII của retcode, chỉ để chẩn đoán. */
export const tradeResultFields = {
  cmd_id: cmdId,
  status: z.enum(['done', 'failed', 'timeout']),
  reason: z.enum(TRADE_REASONS),
  /** retcode MT5 (10009 = DONE); 0 khi lỗi trước khi gọi sàn. */
  code: z.number().int(),
  detail: shortText(120).default(''),
  /** Khối lượng còn lại của lệnh sau khi thực thi (đóng một phần); vắng nếu không biết. */
  left: z.number().finite().nonnegative().optional(),
}

/** EA -> Gateway: `POST /v1/trade_result`. */
export const tradeResultRequestSchema = z.object({
  v: z.literal(1),
  sid: shortText(32).min(1),
  key: shortText(128).min(1),
  login: z.number().int().positive(),
  server: shortText(128).min(1),
  ...tradeResultFields,
})
export type TradeResultRequest = z.infer<typeof tradeResultRequestSchema>

/** Phần lệnh Gateway chuyển cho EA (và hub chuyển cho Gateway). */
export type TradeCommand = {
  cmd_id: string
} & TradeRequest

/** So sánh `a >= b` cho phiên bản dạng `x.y.z`; chuỗi lạ coi là nhỏ hơn. */
export function eaVersionAtLeast(version: string | null | undefined, min: string): boolean {
  const parse = (s: string) => /^(\d+)\.(\d+)\.(\d+)/.exec(s.trim())?.slice(1, 4).map(Number)
  const a = version ? parse(version) : undefined
  const b = parse(min)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return true
}
