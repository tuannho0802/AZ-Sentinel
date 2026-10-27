import { z } from 'zod'

/**
 * Giao dịch thủ công từ xa (v0.2.6, Pha 1): đóng lệnh, đóng một phần, sửa SL/TP.
 * Pha 2 (EA 0.6.0): đóng hàng loạt theo bộ lọc (`close_all`), mở lệnh market và đặt lệnh chờ limit/stop
 * kèm SL/TP. Lệnh MỞ cần thêm công tắc `InpAllowRemoteOpen` của EA (mặc định tắt) và bị chặn bởi `InpMaxRemoteVolume`.
 *
 * Đường đi: FE -> `POST /api/links/:id/trade` -> hub -> Gateway (WebSocket `trade`) -> EA (nằm trong
 * phản hồi `/v1/ping` hoặc `/v1/samples`) -> EA thực thi -> `POST /v1/trade_result` -> Gateway -> hub
 * -> người xem (`trade_result`). Mỗi terminal chỉ có MỘT lệnh đang chờ tại một thời điểm.
 *
 * An toàn: EA có công tắc `InpAllowRemoteTrading` (mặc định tắt), lệnh có `cmd_id` duy nhất và hạn
 * dùng ngắn, EA nhớ `cmd_id` đã chạy để không chạy lại khi bị gửi trùng hay khởi động lại.
 */
export const TRADE_OPS = [
  'close',
  'partial_close',
  'modify',
  'market',
  'pending',
  'close_all',
] as const
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
  /** Phiên bản EA tối thiểu hiểu market, pending, close_all. */
  minEaVerOpen: '0.6.0',
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

/** Hướng của lệnh market. */
export const ORDER_SIDES = ['buy', 'sell'] as const
/** Loại lệnh chờ. */
export const PENDING_KINDS = ['buy_limit', 'sell_limit', 'buy_stop', 'sell_stop'] as const
/** Bộ lọc đóng hàng loạt: all (mặc định), profit (lãi + swap > 0), loss (< 0), buy, sell. */
export const CLOSE_ALL_FILTERS = ['all', 'profit', 'loss', 'buy', 'sell'] as const

/**
 * Mã giao dịch: chỉ ký tự an toàn. EA tách JSON bằng tìm chuỗi nên cấm dấu nháy, gạch chéo, khoảng trắng...
 */
export const SYMBOL_RE = /^[A-Za-z0-9._#@+-]{1,32}$/
const symbol = z.string().regex(SYMBOL_RE)
const lots = z.number().finite().positive().max(TRADE.maxVolume)
/** Giá vào lệnh chờ: phải > 0. */
const entryPrice = z.number().finite().positive().max(1e9)

/** SL/TP đúng phía so với giá vào: mua SL < giá < TP; bán TP < giá < SL; 0 = không đặt. */
export function pendingStopsOk(
  kind: (typeof PENDING_KINDS)[number],
  px: number,
  sl: number,
  tp: number,
): boolean {
  if (kind.startsWith('buy')) return (sl === 0 || sl < px) && (tp === 0 || tp > px)
  return (sl === 0 || sl > px) && (tp === 0 || tp < px)
}

/** Lệnh có khớp bộ lọc close_all không (cùng quy tắc với EA): lãi/lỗ tính cả swap, đúng 0 không thuộc profit/loss. */
export function matchesCloseAll(
  filter: (typeof CLOSE_ALL_FILTERS)[number],
  p: { type: string; profit?: number; swap?: number },
): boolean {
  const net = (p.profit ?? 0) + (p.swap ?? 0)
  switch (filter) {
    case 'all':
      return true
    case 'profit':
      return net > 0
    case 'loss':
      return net < 0
    case 'buy':
      return p.type === 'buy'
    case 'sell':
      return p.type === 'sell'
  }
}

/** Thân `POST /api/links/:id/trade`. */
const tradeUnion = z.discriminatedUnion('op', [
  z.object({ op: z.literal('close'), ticket }),
  z.object({
    op: z.literal('partial_close'),
    ticket,
    volume: z.number().finite().positive().max(TRADE.maxVolume),
  }),
  z.object({ op: z.literal('modify'), ticket, sl: price, tp: price }),
  z.object({
    op: z.literal('market'),
    symbol,
    side: z.enum(ORDER_SIDES),
    volume: lots,
    sl: price,
    tp: price,
  }),
  z.object({
    op: z.literal('pending'),
    symbol,
    kind: z.enum(PENDING_KINDS),
    volume: lots,
    price: entryPrice,
    sl: price,
    tp: price,
  }),
  z.object({ op: z.literal('close_all'), filter: z.enum(CLOSE_ALL_FILTERS) }),
])
export const tradeRequestSchema = tradeUnion.superRefine((r, ctx) => {
  if (r.op === 'pending' && !pendingStopsOk(r.kind, r.price, r.sl, r.tp)) {
    ctx.addIssue({ code: 'custom', message: 'SL/TP sai phía so với giá vào', path: ['sl'] })
  }
})
export type TradeRequest = z.infer<typeof tradeUnion>

/** Lệnh có gắn với một ticket có sẵn (close, partial_close, modify) không. */
export function hasTicket(r: TradeRequest): r is Extract<TradeRequest, { ticket: number }> {
  return r.op === 'close' || r.op === 'partial_close' || r.op === 'modify'
}

/** Phiên bản EA tối thiểu cho một op. */
export function minEaVerForOp(op: TradeOp): string {
  return op === 'market' || op === 'pending' || op === 'close_all'
    ? TRADE.minEaVerOpen
    : TRADE.minEaVer
}

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
  'bad_price',
  'bad_symbol',
  'no_money',
  'no_match',
  'partial',
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
  /** Ticket lệnh vừa tạo (market, pending); vắng nếu không có. */
  order: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  /** close_all: số lệnh đóng được / lỗi. */
  n_ok: z.number().int().nonnegative().optional(),
  n_fail: z.number().int().nonnegative().optional(),
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
