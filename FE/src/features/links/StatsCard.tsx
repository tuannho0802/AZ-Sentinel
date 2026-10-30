import type { StatBasis, StatPeriodKey, Stats } from '@az-sentinel/shared'
import { useState } from 'react'
import { Card } from '../../components/Card'
import { Delta } from '../../components/Money'
import { strings } from '../../lib/strings'

const ROWS: readonly { key: StatPeriodKey; label: string }[] = [
  { key: 'today', label: strings.statsPeriodToday },
  { key: 'yesterday', label: strings.statsPeriodYesterday },
  { key: 'd3', label: strings.statsPeriodD3 },
  { key: 'lastweek', label: strings.statsPeriodLastWeek },
  { key: 'lastmonth', label: strings.statsPeriodLastMonth },
]

const BASES: readonly { key: StatBasis; label: string }[] = [
  { key: 'open', label: strings.statsBasisOpen },
  { key: 'close', label: strings.statsBasisClose },
]

const fmt = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

/** `to` là mốc không gồm: hiển thị đúng mốc đó (giờ máy người xem) để không lệch ngày so với giờ sàn. */
function formatRange(from: number, to: number): string {
  return `${fmt.format(new Date(from * 1000))} → ${fmt.format(new Date(to * 1000))}`
}

const th = 'py-2 pr-3 text-left font-medium'
const thNum = 'py-2 pr-3 text-right font-medium'

/**
 * Thống kê lãi/lỗ theo kỳ. Toàn bộ số do EA tính và gửi (Gateway, hub chỉ chuyển tiếp): FE chỉ chọn cách
 * tính (Open Time hoặc Close Time) rồi hiển thị, không cộng gì thêm.
 */
export function StatsCard({ stats, currency }: { stats: Stats | null; currency: string | null }) {
  const [basis, setBasis] = useState<StatBasis>('close')
  const cur = currency ?? stats?.ccy ?? null
  return (
    <Card
      title={strings.statsTitle}
      action={
        <fieldset className="m-0 flex min-w-0 items-center gap-2 border-0 p-0 text-sm">
          <legend className="sr-only">{strings.statsBasisLabel}</legend>
          <span className="text-muted" aria-hidden="true">
            {strings.statsBasisLabel}
          </span>
          <div className="flex rounded-md border border-line-strong bg-surface p-0.5">
            {BASES.map((b) => {
              const on = basis === b.key
              return (
                <button
                  key={b.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setBasis(b.key)}
                  className={`inline-flex h-7 items-center rounded px-2.5 font-medium whitespace-nowrap transition-colors ${
                    on ? 'bg-ink text-bg' : 'text-muted hover:bg-raised hover:text-ink'
                  }`}
                >
                  {b.label}
                </button>
              )
            })}
          </div>
        </fieldset>
      }
    >
      {stats === null ? (
        <p className="text-sm text-muted">{strings.statsWaiting}</p>
      ) : (
        <>
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[34rem] text-sm">
              <thead className="border-b border-line text-xs text-muted">
                <tr>
                  <th className={th}>{strings.statsColPeriod}</th>
                  <th className={th}>{strings.statsColRange}</th>
                  <th className={thNum}>{strings.statsColPl}</th>
                  <th className={thNum}>{strings.statsColTrades}</th>
                  <th className={`${thNum} !pr-0`}>{strings.statsColWin}</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map(({ key, label }) => {
                  const p = stats.periods[key]
                  const b = p[basis]
                  return (
                    <tr key={key} className="border-b border-line last:border-0">
                      <td className="py-2 pr-3 font-medium">{label}</td>
                      <td className="num py-2 pr-3 text-muted">{formatRange(p.from, p.to)}</td>
                      <td className="py-2 pr-3 text-right">
                        <Delta value={b.pl} currency={cur} />
                      </td>
                      <td className="num py-2 pr-3 text-right">{b.n}</td>
                      <td className="num py-2 text-right">
                        {b.n > 0 ? `${b.w}/${b.n} (${Math.round((b.w / b.n) * 100)}%)` : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted">{strings.statsNote}</p>
        </>
      )}
    </Card>
  )
}
