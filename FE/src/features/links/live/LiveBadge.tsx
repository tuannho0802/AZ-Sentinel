import type { LiveState } from '@az-sentinel/shared'
import { strings } from '../../../lib/strings'

/** Huy hiệu theo `live_state` do server báo (không tự suy từ đồng hồ máy). */
export function LiveBadge({ state }: { state: LiveState | null }) {
  if (state === null) return null
  if (state === 'live') {
    return (
      <span className="ml-1 rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
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
