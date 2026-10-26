import { Icon } from '../../components/Icon'
import { Delta, Money } from '../../components/Money'
import { strings } from '../../lib/strings'
import type { Summary } from './links-view'

type Segment = { key: string; count: number; cls: string }

/** Dải tỉ lệ tình trạng: trang trí (số liệu và chữ nằm ngay trên), nên ẩn với trình đọc màn hình. */
function HealthBar({ summary }: { summary: Summary }) {
  const segments: Segment[] = [
    { key: 'live', count: summary.live, cls: 'bg-live' },
    { key: 'online', count: Math.max(0, summary.online - summary.live), cls: 'bg-gain' },
    { key: 'attention', count: summary.attention, cls: 'bg-loss' },
    { key: 'awaiting', count: summary.awaiting, cls: 'bg-line-strong' },
    { key: 'disabled', count: summary.disabled, cls: 'bg-subtle' },
  ]
  return (
    <div aria-hidden="true" className="flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full">
      {segments
        .filter((s) => s.count > 0)
        .map((s) => (
          <span key={s.key} className={s.cls} style={{ flexGrow: s.count, flexBasis: 0 }} />
        ))}
    </div>
  )
}

function Stat({
  value,
  label,
  tone = 'text-ink',
  icon,
}: {
  value: number
  label: string
  tone?: string
  icon?: boolean
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={`num text-2xl font-semibold ${tone}`}>{value}</span>
      <span className={`text-sm ${tone === 'text-ink' ? 'text-muted' : tone}`}>
        {icon && <Icon name="alert" size={13} className="mr-1 inline align-[-2px]" />}
        {label}
      </span>
    </div>
  )
}

/**
 * Dải tóm tắt đầu trang: đếm theo tình trạng, nổi bật phần "cần chú ý", và tổng theo từng loại tiền
 * (chỉ khi có từ 2 tài khoản cùng loại tiền, không cộng gộp khác tiền tệ).
 */
export function LinksSummary({ summary }: { summary: Summary }) {
  return (
    <section
      aria-label={strings.summaryLabel}
      className="rounded-lg border border-line bg-surface px-4 py-3.5"
    >
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:flex sm:flex-wrap sm:items-baseline sm:gap-x-7">
        <Stat value={summary.total} label={strings.sumAccounts} />
        <Stat value={summary.online} label={strings.sumOnline} tone="text-gain" />
        <Stat value={summary.live} label={strings.sumLive} tone="text-live" />
        <Stat
          value={summary.attention}
          label={strings.sumAttention}
          tone={summary.attention > 0 ? 'text-loss' : 'text-ink'}
          icon={summary.attention > 0}
        />
        {summary.awaiting > 0 && <Stat value={summary.awaiting} label={strings.sumAwaiting} />}
        {summary.disabled > 0 && <Stat value={summary.disabled} label={strings.sumDisabled} />}
        {summary.attention === 0 && (
          <span className="col-span-2 inline-flex items-center gap-1.5 text-sm text-gain sm:ml-auto">
            <Icon name="check" size={14} />
            {strings.sumAllGood}
          </span>
        )}
      </div>
      <div className="mt-3">
        <HealthBar summary={summary} />
      </div>
      {summary.totals.length > 0 && (
        <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-1.5 border-t border-line pt-3 text-sm">
          <dt className="sr-only">{strings.sumTotalsTitle}</dt>
          {summary.totals.map((t) => (
            <dd key={t.currency} className="flex flex-wrap items-baseline gap-x-3">
              <span className="font-medium">{t.currency}</span>
              <span className="text-muted">
                {strings.sumEquity} <Money value={t.equity} currency={t.currency} />
              </span>
              <span className="text-muted">
                {strings.sumFloating} <Delta value={t.pl} currency={t.currency} />
              </span>
            </dd>
          ))}
        </dl>
      )}
    </section>
  )
}
