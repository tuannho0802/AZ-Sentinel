import type { Health } from './links-view'

/**
 * Giữ trạng thái hiển thị ổn định khi terminal chỉ mất kết nối thoáng qua (hysteresis bất đối xứng).
 *
 * - Xấu đi (Live -> Online/Silent/Offline...): chỉ hiển thị khi trạng thái thô thấp hơn trạng thái
 *   đang hiển thị LIÊN TỤC suốt `HEALTH_DOWNGRADE_GRACE_MS`. Tín hiệu quay lại trong khoảng đó thì hủy
 *   bộ đếm, UI không đổi gì (không nhấp nháy, bộ đếm "cần chú ý" không nhảy 0 -> 1 -> 0).
 * - Tốt lên (Offline -> Live...): hiển thị ngay.
 * - `awaiting` / `disabled` là trạng thái cấu trúc (chưa có dữ liệu, bị khóa), không phải mất kết nối
 *   nên đổi tức thì và xóa bộ nhớ.
 *
 * Đây chỉ là lớp làm mượt phần hiển thị; FE vẫn không tự suy online từ giờ máy (Rules FE mục 6).
 * Mốc thời gian dùng `performance.now()` (đơn điệu) nên đổi đồng hồ máy không ảnh hưởng.
 */
export const HEALTH_DOWNGRADE_GRACE_MS = 60_000

/**
 * Thứ bậc "tốt" của các trạng thái liên quan tới kết nối; số lớn = tốt hơn. `waking` và `online`
 * cùng bậc (đều là "đã nối, chưa live") nên đổi qua lại tức thì; chỉ rơi khỏi `live` mới bị làm mượt.
 */
const QUALITY: Partial<Record<Health, number>> = {
  offline: 0,
  silent: 1,
  waking: 2,
  online: 2,
  live: 3,
}

type Entry = {
  shown: Health
  /** Mốc bắt đầu chuỗi liên tục trạng thái thô thấp hơn `shown`; undefined = không có. */
  worseSince: number | undefined
}

export type HealthStabilizer = Map<number, Entry>

export function stabilizeHealth(
  store: HealthStabilizer,
  id: number,
  raw: Health,
  now: number,
  graceMs: number = HEALTH_DOWNGRADE_GRACE_MS,
): Health {
  const rawQ = QUALITY[raw]
  const entry = store.get(id)

  // Trạng thái cấu trúc, hoặc lần đầu thấy liên kết: lấy nguyên giá trị thô.
  if (rawQ === undefined || entry === undefined || QUALITY[entry.shown] === undefined) {
    if (rawQ === undefined) store.delete(id)
    else store.set(id, { shown: raw, worseSince: undefined })
    return raw
  }

  const shownQ = QUALITY[entry.shown] as number

  if (rawQ >= shownQ) {
    // Bằng hoặc tốt hơn: hủy bộ đếm, hiện ngay.
    entry.shown = raw
    entry.worseSince = undefined
    return entry.shown
  }

  // Xấu hơn: bắt đầu (hoặc tiếp tục) đếm; chỉ hạ khi đã xấu liên tục đủ lâu.
  entry.worseSince ??= now
  if (now - entry.worseSince >= graceMs) {
    entry.shown = raw
    entry.worseSince = undefined
  }
  return entry.shown
}

/** Bỏ các liên kết không còn trong danh sách (đã xóa) để bộ nhớ không phình ra. */
export function pruneStabilizer(store: HealthStabilizer, aliveIds: ReadonlySet<number>): void {
  for (const id of store.keys()) if (!aliveIds.has(id)) store.delete(id)
}
