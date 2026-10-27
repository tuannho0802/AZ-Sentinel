import {
  LIVE,
  type LinkDetail,
  type LinkStateView,
  type LinkSummary,
  type LiveState,
  type Position,
  type PositionPl,
  type Sample,
  type ServerMessage,
} from '@az-sentinel/shared'

/**
 * Lớp phủ dữ liệu live (Plan 3B mục 6). Đặt ngoài cache TanStack Query để một lần refetch D1
 * (ví dụ lúc nối lại) không xóa mất mẫu live, và để snapshot đến trước danh sách không bị mất.
 * Tuổi dữ liệu tính bằng `performance.now()` (đơn điệu) cộng chênh lệch giờ SERVER, nên đổi
 * đồng hồ máy người dùng không làm "cập nhật X giây trước" thay đổi (F-14).
 */
export type LiveEntry = {
  state: LiveState | null
  sample: Sample | null
  positionsCount: number | null
  /** Danh sách lệnh đầy đủ gần nhất từ hub (chỉ cần ở trang chi tiết). */
  positions: Position[] | null
  /** Lãi/lỗ hiện tại từng lệnh, đến theo tick khi xem riêng; phủ lên `positions` (hoặc D1). */
  pl: PositionPl | null
  /** Số lần cấu trúc danh sách lệnh đổi (mở/đóng/sửa); trang chi tiết dùng để làm mới sự kiện. */
  posVersion: number
  /** Mốc `performance.now()` mà mẫu hiện tại ra đời theo giờ server; null = chưa có mẫu. */
  sampleAtPerf: number | null
}

/** Kết quả lệnh giao dịch thủ công (v0.2.6), ghép với lệnh đã gửi bằng `cmd_id`. Tách khỏi `entries` vì không phải số liệu liên kết. */
export type TradeResultMsg = Extract<ServerMessage, { t: 'trade_result' }>
const MAX_TRADE_RESULTS = 20
const tradeResults = new Map<string, TradeResultMsg>()
const tradeListeners = new Set<() => void>()

export const subscribeTrade = (l: () => void) => {
  tradeListeners.add(l)
  return () => {
    tradeListeners.delete(l)
  }
}
export const getTradeResult = (cmdId: string | null): TradeResultMsg | undefined =>
  cmdId === null ? undefined : tradeResults.get(cmdId)

function storeTradeResult(msg: TradeResultMsg): void {
  tradeResults.delete(msg.cmd_id) // đẩy xuống cuối để giữ thứ tự mới nhất
  tradeResults.set(msg.cmd_id, msg)
  while (tradeResults.size > MAX_TRADE_RESULTS) {
    const oldest = tradeResults.keys().next().value
    if (oldest === undefined) break
    tradeResults.delete(oldest)
  }
  for (const l of tradeListeners) l()
}

/** Chỉ dùng trong test. */
export function clearTradeResults(): void {
  tradeResults.clear()
}

const entries = new Map<number, LiveEntry>()
const listeners = new Set<() => void>()
let version = 0

function emit(): void {
  version += 1
  for (const l of listeners) l()
}

export const subscribeLive = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
export const liveVersion = () => version
export const getLiveEntry = (id: number): LiveEntry | undefined => entries.get(id)

export function clearLive(): void {
  if (entries.size === 0) return
  entries.clear()
  emit()
}

const empty = (): LiveEntry => ({
  state: null,
  sample: null,
  positionsCount: null,
  positions: null,
  pl: null,
  posVersion: 0,
  sampleAtPerf: null,
})

function sampleAt(serverTime: number, sample: Sample, perfNow: number): number {
  return perfNow - Math.max(0, serverTime - sample.t) * 1000
}

/** Áp một tin từ hub. `kick` do hook xử lý, không đi qua đây. */
export function applyLiveMessage(msg: ServerMessage, perfNow: number = performance.now()): void {
  switch (msg.t) {
    case 'snapshot': {
      // Thay toàn bộ (F-17): không giữ mẫu cũ, không trùng mẫu sau khi nối lại.
      entries.clear()
      for (const l of msg.links) {
        entries.set(l.id, {
          state: l.live_state,
          sample: l.sample,
          positionsCount: l.positions?.length ?? null,
          positions: l.positions ?? null,
          pl: null,
          posVersion: 0,
          sampleAtPerf: l.sample ? sampleAt(msg.server_time, l.sample, perfNow) : null,
        })
      }
      break
    }
    case 'samples': {
      const last = msg.samples.at(-1)
      if (!last) return
      const prev = entries.get(msg.id) ?? empty()
      entries.set(msg.id, {
        ...prev,
        state: 'live',
        sample: last,
        // Tin không kèm `pl` (viewer danh sách) giữ nguyên giá trị cũ thay vì xóa.
        pl: msg.pl ?? prev.pl,
        sampleAtPerf: sampleAt(msg.server_time, last, perfNow),
      })
      break
    }
    case 'positions': {
      const prev = entries.get(msg.id) ?? empty()
      entries.set(msg.id, {
        ...prev,
        positionsCount: msg.positions.length,
        positions: msg.positions,
        pl: null, // danh sách đầy đủ đã gồm lãi/lỗ hiện tại
        posVersion: prev.posVersion + 1,
      })
      break
    }
    case 'live_state': {
      const prev = entries.get(msg.id) ?? empty()
      entries.set(msg.id, { ...prev, state: msg.state })
      break
    }
    case 'trade_result':
      storeTradeResult(msg)
      return
    case 'kick':
      return
  }
  emit()
}

/**
 * Trạng thái hiển thị của một liên kết. `null` khi chưa nối. Nối mà chưa có tin về liên kết đó
 * thì là `waking` (có người xem, EA chưa vào live). Mẫu im quá `LIVE.staleSec` thì `idle` (không
 * phản hồi): huy hiệu Live không còn hiện tuổi mẫu nên phải hạ cờ nhanh khi EA ngừng gửi.
 */
export function effectiveLiveState(
  entry: LiveEntry | undefined,
  connected: boolean,
  perfNow: number,
): LiveState | null {
  if (!connected) return null
  if (entry?.state === 'live' && entry.sampleAtPerf !== null) {
    const age = (perfNow - entry.sampleAtPerf) / 1000
    return age > LIVE.staleSec ? 'idle' : 'live'
  }
  return entry?.state ?? 'waking'
}

/** Phủ mẫu live lên số liệu D1 để hiển thị (balance, equity, lãi/lỗ, margin level). */
export function mergeLive(link: LinkSummary, entry: LiveEntry | undefined): LinkSummary {
  const s = entry?.sample
  if (!s) return link
  const base: LinkStateView = link.state ?? {
    balance: null,
    equity: null,
    margin: null,
    margin_free: null,
    margin_level: null,
    floating_pl: null,
    last_reason: null,
    last_seen_at: s.t,
    last_seq: null,
    ea_ver: null,
    vps_label: null,
    positions_count: 0,
    online: true,
  }
  return {
    ...link,
    state: {
      ...base,
      balance: s.bal,
      equity: s.eq,
      // EA >= 0.5.0 gửi margin theo mẫu; EA cũ không có thì giữ số D1.
      margin: s.mg ?? base.margin,
      floating_pl: s.fl,
      margin_level: s.ml ?? null,
      last_seen_at: s.t,
      positions_count: entry?.positionsCount ?? base.positions_count,
      // Có mẫu live nghĩa là server vừa nhận từ EA: chắc chắn online (không tự suy từ giờ máy).
      online: true,
    },
  }
}

/** Phủ lãi/lỗ theo tick lên danh sách lệnh: ưu tiên danh sách của hub, rồi tới bản D1. */
export function livePositions(base: Position[], entry: LiveEntry | undefined): Position[] {
  const list = entry?.positions ?? base
  const pl = entry?.pl
  if (!pl) return list
  return list.map((p) => {
    const profit = pl[String(p.ticket)]
    return profit === undefined ? p : { ...p, profit }
  })
}

/**
 * Như `mergeLive` nhưng cho trang chi tiết: thêm danh sách lệnh với lãi/lỗ theo tick.
 *
 * Đồng bộ ô "Lãi/lỗ đang mở" với bảng lệnh: `ACCOUNT_PROFIT` và `POSITION_PROFIT` do EA đọc ở hai
 * thời điểm nên có thể lệch nhau vài tick. Khi đã có `pl` theo tick cho MỌI lệnh trong bảng thì ô
 * tổng được tính lại từ chính các lệnh đó (lãi/lỗ + swap), nên hai chỗ luôn khớp nhau.
 */
export function mergeLiveDetail(link: LinkDetail, entry: LiveEntry | undefined): LinkDetail {
  const merged = mergeLive(link, entry)
  const positions = livePositions(link.positions, entry)
  const pl = entry?.pl
  const covered =
    pl !== null &&
    pl !== undefined &&
    positions.length > 0 &&
    positions.every((p) => pl[String(p.ticket)] !== undefined)
  if (!covered || !merged.state) return { ...link, state: merged.state, positions }
  const total = positions.reduce((sum, p) => sum + (p.profit ?? 0) + (p.swap ?? 0), 0)
  return {
    ...link,
    state: { ...merged.state, floating_pl: Math.round(total * 100) / 100 },
    positions,
  }
}
