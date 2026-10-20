import { formatTime } from '../../lib/format'
import { strings } from '../../lib/strings'
import { REFRESH_OPTIONS_MS } from './refresh'

type Props = {
  value: number
  onChange: (ms: number) => void
  updatedAt: number
  onRefresh: () => void
}

export function RefreshControl({ value, onChange, updatedAt, onRefresh }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {updatedAt > 0 && (
        <span className="text-gray-500">
          {strings.updatedAt} {formatTime(updatedAt)}
        </span>
      )}
      <label htmlFor="auto-refresh" className="text-gray-600">
        {strings.autoRefresh}
      </label>
      <select
        id="auto-refresh"
        className="rounded border px-2 py-1"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {REFRESH_OPTIONS_MS.map((ms) => (
          <option key={ms} value={ms}>
            {strings.refreshSeconds(ms / 1000)}
          </option>
        ))}
        <option value={0}>{strings.refreshOff}</option>
      </select>
      <button type="button" className="rounded border px-3 py-1" onClick={onRefresh}>
        {strings.refresh}
      </button>
    </div>
  )
}
