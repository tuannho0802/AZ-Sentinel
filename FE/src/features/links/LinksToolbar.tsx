import { Icon } from '../../components/Icon'
import { inputClass } from '../../components/styles'
import { strings } from '../../lib/strings'
import type { Filter, SortKey, Summary, View } from './links-view'

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'vps', label: strings.sortVps },
  { key: 'attention', label: strings.sortAttention },
  { key: 'equity', label: strings.sortEquity },
  { key: 'pl', label: strings.sortPl },
]

/** Bộ lọc dạng nút bật/tắt (aria-pressed), ô tìm và ô sắp xếp. Mọi lựa chọn chỉ nằm ở FE. */
export function LinksToolbar({
  view,
  onChange,
  summary,
}: {
  view: View
  onChange: (next: View) => void
  summary: Summary
}) {
  const filters: { key: Filter; label: string; count: number | null }[] = [
    { key: 'all', label: strings.filterAll, count: null },
    { key: 'attention', label: strings.filterAttention, count: summary.attention },
    { key: 'live', label: strings.filterLive, count: summary.live },
  ]
  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
      <fieldset className="m-0 flex w-full min-w-0 rounded-md border border-line-strong bg-surface p-0.5 sm:inline-flex sm:w-auto">
        <legend className="sr-only">{strings.filterGroup}</legend>
        {filters.map((f) => {
          const on = view.filter === f.key
          return (
            <button
              key={f.key}
              type="button"
              aria-pressed={on}
              onClick={() => onChange({ ...view, filter: f.key })}
              className={`inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded px-3 text-sm sm:h-8 sm:flex-none font-medium whitespace-nowrap transition-colors ${
                on ? 'bg-ink text-bg' : 'text-muted hover:bg-raised hover:text-ink'
              }`}
            >
              {f.label}
              {f.count !== null && <span className="num text-xs opacity-80">{f.count}</span>}
            </button>
          )
        })}
      </fieldset>

      <div className="relative min-w-0 flex-1 basis-40 sm:max-w-xs">
        <label htmlFor="links-search" className="sr-only">
          {strings.searchLabel}
        </label>
        <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-subtle">
          <Icon name="search" size={15} />
        </span>
        <input
          id="links-search"
          type="search"
          value={view.query}
          placeholder={strings.searchPlaceholder}
          onChange={(e) => onChange({ ...view, query: e.target.value })}
          className={`${inputClass} pl-8`}
        />
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="links-sort" className="sr-only text-sm text-muted sm:not-sr-only">
          {strings.sortLabel}
        </label>
        <select
          id="links-sort"
          value={view.sort}
          onChange={(e) => onChange({ ...view, sort: e.target.value as SortKey })}
          className={`${inputClass} w-auto pr-8`}
        >
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
