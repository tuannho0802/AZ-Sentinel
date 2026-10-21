import { Link } from 'wouter'
import { Delta, Money } from '../../components/Money'
import { formatRelative } from '../../lib/format'
import { strings } from '../../lib/strings'
import { useNow } from '../../lib/use-now'
import type { Health, LinkRow } from './links-view'
import { RotateKeyButton } from './RotateKeyButton'
import { StatusBadge } from './StatusBadge'
import { VpsNameCell } from './VpsNameCell'

const th = 'px-3 py-2.5 text-left text-xs font-medium whitespace-nowrap text-muted'
const thNum = `${th} !text-right`
const td = 'px-3 py-3 align-middle'

/** Vạch màu bên trái dòng + nền nhẹ cho dòng cần chú ý: giúp quét mắt, chữ trong huy hiệu vẫn là nguồn chính. */
const rowLook: Record<Health, { stripe: string; bg: string }> = {
  live: { stripe: 'border-l-live', bg: '' },
  waking: { stripe: 'border-l-line-strong', bg: '' },
  silent: { stripe: 'border-l-notice-ink', bg: 'bg-notice-bg/40' },
  online: { stripe: 'border-l-gain', bg: '' },
  offline: { stripe: 'border-l-loss', bg: 'bg-loss-bg/50' },
  awaiting: { stripe: 'border-l-transparent', bg: '' },
  disabled: { stripe: 'border-l-transparent', bg: 'opacity-65' },
}

export function LinksTable({ rows }: { rows: LinkRow[] }) {
  const now = useNow()
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full min-w-[56rem] border-collapse text-sm">
        <thead className="border-b border-line bg-raised">
          <tr>
            <th className={th}>{strings.colPresence}</th>
            <th className={th}>{strings.colAccount}</th>
            <th className={`${th} hidden xl:table-cell`}>{strings.colAccountName}</th>
            <th className={th}>{strings.colVps}</th>
            <th className={thNum}>{strings.colBalance}</th>
            <th className={thNum}>{strings.colEquity}</th>
            <th className={thNum}>{strings.colPl}</th>
            <th className={th}>{strings.colLastSeen}</th>
            <th className={th}>
              <span className="sr-only">{strings.actionsTitle}</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map(({ link: l, health, liveState }) => {
            const currency = l.account?.currency ?? null
            const look = rowLook[health]
            return (
              <tr key={l.id} className={`hover:bg-raised/60 ${look.bg}`}>
                <td className={`${td} border-l-[3px] ${look.stripe}`}>
                  <StatusBadge health={health} hasAccount={l.account !== null} />
                </td>
                <td className={td}>
                  {l.account ? (
                    <>
                      <div className="num font-medium">{l.account.login}</div>
                      <div className="text-xs text-muted">{l.account.server}</div>
                    </>
                  ) : (
                    <span className="text-muted">{strings.unbound}</span>
                  )}
                </td>
                <td className={`${td} hidden xl:table-cell`}>{l.account?.name || '—'}</td>
                <td className={td}>
                  <VpsNameCell linkId={l.id} value={l.vps_name} />
                </td>
                <td className={`${td} text-right whitespace-nowrap`}>
                  <Money value={l.state?.balance} currency={currency} />
                </td>
                <td className={`${td} text-right font-medium whitespace-nowrap`}>
                  <Money value={l.state?.equity} currency={currency} />
                </td>
                <td className={`${td} text-right whitespace-nowrap`}>
                  <Delta value={l.state?.floating_pl} currency={currency} />
                </td>
                <td className={`${td} whitespace-nowrap`}>
                  {liveState === 'live' ? (
                    <span className="text-live">{strings.lastSeenLive}</span>
                  ) : l.state ? (
                    <span className="text-muted">{formatRelative(l.state.last_seen_at, now)}</span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className={`${td} whitespace-nowrap`}>
                  <div className="flex items-center justify-end gap-1.5">
                    <span className="num mr-1 text-xs text-subtle">#{l.id}</span>
                    <Link
                      href={`/links/${l.id}`}
                      className="inline-flex h-7 items-center rounded-md border border-line-strong bg-surface px-2.5 text-[0.8125rem] font-medium text-ink transition-colors hover:bg-raised"
                    >
                      {strings.viewDetail}
                    </Link>
                    <RotateKeyButton linkId={l.id} variant="ghost" />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
