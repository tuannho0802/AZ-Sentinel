import type { CardMode } from '../../lib/card-mode'
import { strings } from '../../lib/strings'

const OPTIONS: { mode: CardMode; label: string }[] = [
  { mode: 'compact', label: strings.cardModeCompact },
  { mode: 'detailed', label: strings.cardModeDetailed },
]

/** Nút chọn kiểu thẻ trên điện thoại (cùng kiểu với bộ lọc: nhóm nút bật/tắt `aria-pressed`). */
export function CardModeToggle({
  mode,
  onChange,
}: {
  mode: CardMode
  onChange: (next: CardMode) => void
}) {
  return (
    <fieldset className="m-0 flex w-full min-w-0 rounded-md border border-line-strong bg-surface p-0.5">
      <legend className="sr-only">{strings.cardModeGroup}</legend>
      {OPTIONS.map((o) => {
        const on = mode === o.mode
        return (
          <button
            key={o.mode}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.mode)}
            className={`inline-flex h-9 flex-1 items-center justify-center rounded px-3 text-sm font-medium whitespace-nowrap transition-colors ${
              on ? 'bg-ink text-bg' : 'text-muted hover:bg-raised hover:text-ink'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </fieldset>
  )
}
