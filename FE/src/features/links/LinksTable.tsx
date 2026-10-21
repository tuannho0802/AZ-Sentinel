import type { LinkSummary } from '@az-sentinel/shared'
import { Link } from 'wouter'
import { formatMoney, formatRelative, formatSigned, plClass } from '../../lib/format'
import { strings } from '../../lib/strings'
import { useNow } from '../../lib/use-now'
import { LiveBadge } from './live/LiveBadge'
import { effectiveLiveState, getLiveEntry, mergeLive } from './live/live-store'
import { PresenceBadge } from './PresenceBadge'
import { RotateKeyButton } from './RotateKeyButton'

const th = 'px-3 py-2 whitespace-nowrap'

export function LinksTable({
  links,
  connected = false,
}: {
  links: LinkSummary[]
  /** WebSocket live đang nối: chỉ khi đó mới phủ dữ liệu live lên số liệu D1. */
  connected?: boolean
}) {
  const now = useNow()
  const perf = performance.now()
  return (
    <div className="overflow-x-auto rounded-lg border bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b bg-gray-50 text-gray-500">
          <tr>
            <th className={th}>{strings.colId}</th>
            <th className={th}>{strings.colKey}</th>
            <th className={th}>{strings.colAccount}</th>
            <th className={th}>{strings.colAccountName}</th>
            <th className={th}>{strings.colPresence}</th>
            <th className={th}>{strings.colBalance}</th>
            <th className={th}>{strings.colEquity}</th>
            <th className={th}>{strings.colPl}</th>
            <th className={th}>{strings.colLastSeen}</th>
            <th className={th} />
          </tr>
        </thead>
        <tbody>
          {links.map((raw) => {
            const entry = connected ? getLiveEntry(raw.id) : undefined
            const l = mergeLive(raw, entry)
            const liveState =
              raw.status === 'active' ? effectiveLiveState(entry, connected, perf) : null
            const currency = l.account?.currency ?? null
            return (
              <tr key={l.id} className="border-b last:border-0">
                <td className="px-3 py-2">{l.id}</td>
                <td className="px-3 py-2">
                  <RotateKeyButton linkId={l.id} />
                </td>
                <td className="px-3 py-2">
                  {l.account ? (
                    <>
                      <div>{l.account.login}</div>
                      <div className="text-xs text-gray-500">{l.account.server}</div>
                    </>
                  ) : (
                    <span className="text-gray-500">{strings.unbound}</span>
                  )}
                </td>
                <td className="px-3 py-2">{l.account?.name || '—'}</td>
                <td className="px-3 py-2">
                  <PresenceBadge link={l} />
                  {/* Live nằm ở cột "Nhận gần nhất"; ở đây chỉ còn đánh thức / không phản hồi. */}
                  <LiveBadge state={liveState === 'live' ? null : liveState} />
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {formatMoney(l.state?.balance, currency)}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {formatMoney(l.state?.equity, currency)}
                </td>
                <td className={`px-3 py-2 whitespace-nowrap ${plClass(l.state?.floating_pl)}`}>
                  {formatSigned(l.state?.floating_pl, currency)}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {liveState === 'live' ? (
                    <LiveBadge state="live" />
                  ) : l.state ? (
                    formatRelative(l.state.last_seen_at, now)
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <Link href={`/links/${l.id}`} className="underline">
                    {strings.viewDetail}
                  </Link>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
