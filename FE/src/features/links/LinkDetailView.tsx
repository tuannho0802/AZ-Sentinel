import type { LinkDetail, LiveState } from '@az-sentinel/shared'
import type { ReactNode } from 'react'
import { Card } from '../../components/Card'
import {
  formatDateTime,
  formatMoney,
  formatPercent,
  formatRelative,
  formatSigned,
  plClass,
} from '../../lib/format'
import { strings } from '../../lib/strings'
import { useNow } from '../../lib/use-now'
import { LinkActions } from './LinkActions'
import { LiveBadge } from './live/LiveBadge'
import { PresenceBadge } from './PresenceBadge'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-0.5">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  )
}

/** Mọi chuỗi do EA gửi (tên, broker, comment...) hiển thị dạng văn bản thuần (Rules FE mục 7). */
export function LinkDetailView({
  link,
  liveState = null,
}: {
  /** Đã phủ số liệu live (`mergeLiveDetail`) nếu đang nối. */
  link: LinkDetail
  /** Trạng thái live hiệu dụng; `live` thì huy hiệu Live thay cho "X giây trước" nhấp nháy. */
  liveState?: LiveState | null
}) {
  const now = useNow()
  const a = link.account
  const s = link.state
  const currency = a?.currency ?? null
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">
          {strings.linksPageTitle} #{link.id}
        </h1>
        <PresenceBadge link={link} />
        {/* Live nằm ở dòng "Nhận gần nhất"; ở đây chỉ còn đánh thức / không phản hồi. */}
        <LiveBadge state={liveState === 'live' ? null : liveState} />
      </div>
      {!s && <p className="rounded bg-blue-50 p-3 text-sm text-blue-800">{strings.waitingFirst}</p>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card title={strings.accountTitle}>
          <dl className="text-sm">
            <Row label={strings.fieldKeyPrefix}>
              <span className="font-mono">{link.key_prefix}…</span>
            </Row>
            <Row label={strings.colStatus}>
              {link.status === 'active' ? strings.statusActive : strings.statusDisabled}
            </Row>
            {a ? (
              <>
                <Row label={strings.fieldLogin}>{a.login}</Row>
                <Row label={strings.fieldServer}>{a.server}</Row>
                <Row label={strings.fieldBroker}>{a.broker ?? '—'}</Row>
                <Row label={strings.fieldName}>{a.name ?? '—'}</Row>
                <Row label={strings.fieldMode}>{a.mode ?? '—'}</Row>
                <Row label={strings.fieldCurrency}>{a.currency ?? '—'}</Row>
                {link.bound_at !== null && (
                  <Row label={strings.fieldBoundAt}>{formatDateTime(link.bound_at)}</Row>
                )}
              </>
            ) : (
              <Row label={strings.colAccount}>{strings.unbound}</Row>
            )}
          </dl>
        </Card>

        <Card title={strings.stateTitle}>
          {s ? (
            <dl className="text-sm">
              <Row label={strings.fieldBalance}>{formatMoney(s.balance, currency)}</Row>
              <Row label={strings.fieldEquity}>{formatMoney(s.equity, currency)}</Row>
              <Row label={strings.fieldMargin}>{formatMoney(s.margin, currency)}</Row>
              <Row label={strings.fieldMarginFree}>{formatMoney(s.margin_free, currency)}</Row>
              <Row label={strings.fieldMarginLevel}>{formatPercent(s.margin_level)}</Row>
              <Row label={strings.fieldFloating}>
                <span className={plClass(s.floating_pl)}>
                  {formatSigned(s.floating_pl, currency)}
                </span>
              </Row>
              <Row label={strings.fieldVps}>{s.vps_label ?? '—'}</Row>
              <Row label={strings.fieldEaVer}>{s.ea_ver ?? '—'}</Row>
              <Row label={strings.fieldSeq}>{s.last_seq ?? '—'}</Row>
              <Row label={strings.fieldReason}>{s.last_reason ?? '—'}</Row>
              <Row label={strings.fieldLastSeen}>
                {liveState === 'live' ? (
                  <LiveBadge state="live" />
                ) : (
                  <span title={formatDateTime(s.last_seen_at)}>
                    {formatRelative(s.last_seen_at, now)}
                  </span>
                )}
              </Row>
            </dl>
          ) : (
            <p className="text-sm text-gray-500">{strings.noData}</p>
          )}
        </Card>
      </div>

      <Card title={`${strings.positionsTitle} (${link.positions.length})`}>
        {link.positions.length === 0 ? (
          <p className="text-sm text-gray-500">{strings.positionsEmpty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-gray-500">
                <tr>
                  <th className="py-1 pr-3">{strings.colTicket}</th>
                  <th className="py-1 pr-3">{strings.colSymbol}</th>
                  <th className="py-1 pr-3">{strings.colType}</th>
                  <th className="py-1 pr-3">{strings.colVolume}</th>
                  <th className="py-1 pr-3">{strings.colOpenPrice}</th>
                  <th className="py-1">{strings.colProfit}</th>
                </tr>
              </thead>
              <tbody>
                {link.positions.map((p) => (
                  <tr key={p.ticket} className="border-t">
                    <td className="py-1 pr-3">{p.ticket}</td>
                    <td className="py-1 pr-3">{p.symbol}</td>
                    <td className="py-1 pr-3">{p.type}</td>
                    <td className="py-1 pr-3">{p.volume}</td>
                    <td className="py-1 pr-3">{p.price}</td>
                    <td className={`py-1 ${plClass(p.profit)}`}>
                      {formatSigned(p.profit, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title={strings.eventsTitle}>
        {link.events.length === 0 ? (
          <p className="text-sm text-gray-500">{strings.eventsEmpty}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {link.events.map((e) => (
              <li key={e.id} className="flex flex-wrap gap-x-3 border-t py-1 first:border-0">
                <span className="text-gray-500">{formatDateTime(e.ts)}</span>
                <span className="font-medium">{e.type}</span>
                {e.detail !== null && (
                  <code className="break-all text-xs text-gray-600">
                    {JSON.stringify(e.detail)}
                  </code>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={strings.actionsTitle}>
        <LinkActions link={link} />
      </Card>
    </div>
  )
}
