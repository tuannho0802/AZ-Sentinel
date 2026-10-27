import type { LinkDetail, LiveState } from '@az-sentinel/shared'
import type { ReactNode } from 'react'
import { Card } from '../../components/Card'
import { Delta, Money } from '../../components/Money'
import { formatDateShort, formatDateTime, formatPercent, formatRelative } from '../../lib/format'
import { strings } from '../../lib/strings'
import { useNow } from '../../lib/use-now'
import { LinkActions } from './LinkActions'
import { classify } from './links-view'
import { PositionsFooter } from './PositionsFooter'
import { StatusBadge } from './StatusBadge'
import { PositionTradeActions, TradeEnableToggle } from './TradeControls'
import { VpsNameCell } from './VpsNameCell'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line py-2 last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  )
}

function Metric({
  label,
  children,
  big = false,
}: {
  label: string
  children: ReactNode
  big?: boolean
}) {
  return (
    <div className="min-w-0 px-4 py-3.5">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className={`num mt-1 truncate font-semibold ${big ? 'text-3xl' : 'text-xl'}`}>
        {children}
      </dd>
    </div>
  )
}

const typeClass = (t: string) => (t.startsWith('buy') ? 'text-live' : 'text-accent-text')
const thNum = 'py-2 pr-3 text-right font-medium'
const th = 'py-2 pr-3 text-left font-medium'

/** Mọi chuỗi do EA gửi (tên, broker, comment...) hiển thị dạng văn bản thuần (Rules FE mục 7). */
export function LinkDetailView({
  link,
  liveState = null,
  tradeAdmin = false,
}: {
  /** Đã phủ số liệu live (`mergeLiveDetail`) nếu đang nối. */
  link: LinkDetail
  /** Trạng thái live hiệu dụng. */
  liveState?: LiveState | null
  /** Quản trị viên: thấy công tắc và nút giao dịch từ xa. Mặc định tắt. */
  tradeAdmin?: boolean
}) {
  const now = useNow()
  const a = link.account
  const s = link.state
  const currency = a?.currency ?? null
  const health = classify(link, liveState)
  const showTrade = tradeAdmin && link.trade_enabled === true
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">
          {strings.linksPageTitle} #{link.id}
        </h1>
        <StatusBadge health={health} hasAccount={a !== null} />
      </div>

      {!s && (
        <p className="rounded-md bg-live-bg px-3 py-2.5 text-sm text-live">
          {strings.waitingFirst}
        </p>
      )}

      {s && (
        <section
          aria-label={strings.detailMetrics}
          className="rounded-lg border border-line bg-surface"
        >
          <dl className="grid grid-cols-2 divide-line sm:grid-cols-4 sm:divide-x [&>div:nth-child(n+3)]:border-t [&>div:nth-child(n+3)]:border-line sm:[&>div:nth-child(n+3)]:border-t-0 [&>div:nth-child(even)]:border-l [&>div:nth-child(even)]:border-line sm:[&>div:nth-child(even)]:border-l-0">
            <Metric label={strings.fieldEquity} big>
              <Money value={s.equity} currency={currency} />
            </Metric>
            <Metric label={strings.fieldFloating} big>
              <Delta value={s.floating_pl} currency={currency} />
            </Metric>
            <Metric label={strings.fieldBalance}>
              <Money value={s.balance} currency={currency} />
            </Metric>
            <Metric label={strings.fieldMarginLevel}>{formatPercent(s.margin_level)}</Metric>
          </dl>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={strings.accountTitle}>
          <dl className="text-sm">
            <Row label={strings.fieldKeyPrefix}>
              <span className="font-mono">{link.key_prefix}…</span>
            </Row>
            <Row label={strings.colStatus}>
              {link.status === 'active' ? strings.statusActive : strings.statusDisabled}
            </Row>
            <Row label={strings.fieldVpsName}>
              <VpsNameCell linkId={link.id} value={link.vps_name} />
            </Row>
            {tradeAdmin && a && (
              <Row label={strings.tradeRemoteTitle}>
                <TradeEnableToggle linkId={link.id} enabled={link.trade_enabled === true} />
              </Row>
            )}
            {a ? (
              <>
                <Row label={strings.fieldLogin}>
                  <span className="num">{a.login}</span>
                </Row>
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
              <Row label={strings.fieldMargin}>
                <Money value={s.margin} currency={currency} />
              </Row>
              <Row label={strings.fieldMarginFree}>
                <Money value={s.margin_free} currency={currency} />
              </Row>
              <Row label={strings.fieldVps}>{s.vps_label ?? '—'}</Row>
              <Row label={strings.fieldEaVer}>{s.ea_ver ?? '—'}</Row>
              <Row label={strings.fieldSeq}>
                <span className="num">{s.last_seq ?? '—'}</span>
              </Row>
              <Row label={strings.fieldReason}>{s.last_reason ?? '—'}</Row>
              <Row label={strings.fieldLastSeen}>
                {liveState === 'live' ? (
                  <span className="text-live">{strings.lastSeenLive}</span>
                ) : (
                  <span title={formatDateTime(s.last_seen_at)}>
                    {formatRelative(s.last_seen_at, now)}
                  </span>
                )}
              </Row>
            </dl>
          ) : (
            <p className="text-sm text-muted">{strings.noData}</p>
          )}
        </Card>
      </div>

      <Card title={`${strings.positionsTitle} (${link.positions.length})`}>
        {link.positions.length === 0 ? (
          <p className="text-sm text-muted">{strings.positionsEmpty}</p>
        ) : (
          <div className="-mx-4 overflow-x-auto px-4">
            <table className={`w-full text-sm ${showTrade ? 'min-w-[64rem]' : 'min-w-[54rem]'}`}>
              <thead className="border-b border-line text-xs text-muted">
                <tr>
                  <th className={th}>{strings.colTicket}</th>
                  <th className={th}>{strings.colSymbol}</th>
                  <th className={th}>{strings.colType}</th>
                  <th className={thNum}>{strings.colVolume}</th>
                  <th className={thNum}>{strings.colOpenPrice}</th>
                  <th className={thNum}>{strings.colSl}</th>
                  <th className={thNum}>{strings.colTp}</th>
                  <th className={th}>{strings.colOpenTime}</th>
                  <th className={thNum}>{strings.colSwap}</th>
                  <th className={`${thNum} ${showTrade ? '' : '!pr-0'}`}>{strings.colProfit}</th>
                  {showTrade && <th className={`${thNum} !pr-0`}>{strings.colTradeActions}</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {link.positions.map((p) => (
                  <tr key={p.ticket}>
                    <td className="num py-2 pr-3 text-muted">{p.ticket}</td>
                    <td className="py-2 pr-3 font-medium">{p.symbol}</td>
                    <td className={`py-2 pr-3 font-medium ${typeClass(p.type)}`}>{p.type}</td>
                    <td className="num py-2 pr-3 text-right">{p.volume}</td>
                    <td className="num py-2 pr-3 text-right">{p.price}</td>
                    <td className="num py-2 pr-3 text-right">{p.sl ? p.sl : '—'}</td>
                    <td className="num py-2 pr-3 text-right">{p.tp ? p.tp : '—'}</td>
                    <td className="py-2 pr-3 whitespace-nowrap" title={formatDateTime(p.time)}>
                      {formatDateShort(p.time)}
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <Delta value={p.swap ?? null} currency={currency} />
                    </td>
                    <td className={`py-2 text-right ${showTrade ? 'pr-3' : ''}`}>
                      <Delta value={p.profit} currency={currency} />
                    </td>
                    {showTrade && (
                      <td className="py-2 text-right">
                        <PositionTradeActions
                          linkId={link.id}
                          position={p}
                          disabled={liveState !== 'live'}
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {s && (
          <PositionsFooter
            state={s}
            positions={link.positions}
            live={liveState === 'live'}
            currency={currency}
          />
        )}
      </Card>

      <Card title={strings.eventsTitle}>
        {link.events.length === 0 ? (
          <p className="text-sm text-muted">{strings.eventsEmpty}</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {link.events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2">
                <span className="num text-muted">{formatDateTime(e.ts)}</span>
                <span className="font-medium">{e.type}</span>
                {e.detail !== null && (
                  <code className="text-xs break-all text-muted">{JSON.stringify(e.detail)}</code>
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
