import type { LinkSummary } from '@az-sentinel/shared'
import { strings } from '../../lib/strings'

/** Dùng trạng thái server trả về, không tự tính từ last_seen_at (Rules FE mục 6). */
export function PresenceBadge({ link }: { link: LinkSummary }) {
  if (link.status === 'disabled') {
    return <span className="rounded bg-gray-200 px-2 py-0.5 text-xs">{strings.statusDisabled}</span>
  }
  if (!link.state) {
    return (
      <span className="text-xs text-gray-500">
        {link.account ? strings.noData : strings.awaitingEa}
      </span>
    )
  }
  return link.state.online ? (
    <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700">
      ● {strings.online}
    </span>
  ) : (
    <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-700">● {strings.offline}</span>
  )
}
