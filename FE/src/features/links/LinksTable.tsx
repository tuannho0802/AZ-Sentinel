import type { LinkSummary } from '@az-sentinel/shared'
import { Link } from 'wouter'
import { formatMoney, formatRelative, formatSigned, plClass } from '../../lib/format'
import { strings } from '../../lib/strings'
import { PresenceBadge } from './PresenceBadge'
import { RotateKeyButton } from './RotateKeyButton'

export function LinksTable({ links }: { links: LinkSummary[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b bg-gray-50 text-gray-500">
          <tr>
            <th className="px-3 py-2">{strings.colId}</th>
            <th className="px-3 py-2">{strings.colKey}</th>
            <th className="px-3 py-2">{strings.colAccount}</th>
            <th className="px-3 py-2">{strings.colPresence}</th>
            <th className="px-3 py-2">{strings.colEquity}</th>
            <th className="px-3 py-2">{strings.colPl}</th>
            <th className="px-3 py-2">{strings.colLastSeen}</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {links.map((l) => {
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
                      {l.account.name && <div className="text-sm">{l.account.name}</div>}
                      <div className="text-xs text-gray-500">{l.account.server}</div>
                    </>
                  ) : (
                    <span className="text-gray-500">{strings.unbound}</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <PresenceBadge link={l} />
                </td>
                <td className="px-3 py-2">{formatMoney(l.state?.equity, currency)}</td>
                <td className={`px-3 py-2 ${plClass(l.state?.floating_pl)}`}>
                  {formatSigned(l.state?.floating_pl, currency)}
                </td>
                <td className="px-3 py-2">
                  {l.state ? formatRelative(l.state.last_seen_at) : '—'}
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
