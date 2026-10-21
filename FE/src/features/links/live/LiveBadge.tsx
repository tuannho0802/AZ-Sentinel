import type { LiveState } from '@az-sentinel/shared'
import { strings } from '../../../lib/strings'

/** Huy hiệu theo `live_state` do server báo (không tự suy từ đồng hồ máy). */
export function LiveBadge({ state }: { state: LiveState | null }) {
  if (state === null) return null
  if (state === 'live') {
    // Xanh lá + chấm nhấp nháy: đặt ở cột "Nhận gần nhất" thay cho nhãn "vừa xong" cứ nhảy giữa các tick.
    return (
      <span className="inline-flex items-center gap-1 rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
        <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
        {strings.badgeLive}
      </span>
    )
  }
  if (state === 'waking') {
    return (
      <span className="ml-1 rounded bg-yellow-100 px-2 py-0.5 text-xs text-yellow-800">
        {strings.badgeWaking}
      </span>
    )
  }
  return (
    <span className="ml-1 rounded bg-gray-200 px-2 py-0.5 text-xs text-gray-700">
      {strings.badgeIdle}
    </span>
  )
}
