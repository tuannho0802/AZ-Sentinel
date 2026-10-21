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

/** Như `mergeLive` nhưng cho trang chi tiết: thêm danh sách lệnh với lãi/lỗ theo tick. */
export function mergeLiveDetail(link: LinkDetail, entry: LiveEntry | undefined): LinkDetail {
  const merged = mergeLive(link, entry)
  return { ...link, state: merged.state, positions: livePositions(link.positions, entry) }
}
