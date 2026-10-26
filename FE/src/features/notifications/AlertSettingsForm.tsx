import { ALERT, type GrowthMode } from '@az-sentinel/shared'
import { useId, useState } from 'react'
import { Button } from '../../components/Button'
import { inputClass } from '../../components/styles'
import { strings } from '../../lib/strings'
import { useAlertSettings, useSaveAlertSettings } from './api'

/** Chấp nhận "5", "5.5" và "5,5". `null` khi không hợp lệ (0 là tắt, còn lại 0,1 đến 100). */
export function parseLossPct(text: string): number | null {
  const v = Number(text.trim().replace(',', '.'))
  if (!Number.isFinite(v) || text.trim() === '') return null
  if (v === 0) return 0
  return v >= 0.1 && v <= ALERT.maxLossBp / 100 ? v : null
}

const showPct = (v: number) => String(v).replace('.', ',')

const MODES: { value: GrowthMode; label: string; hint: string }[] = [
  {
    value: 'balance',
    label: strings.alertModeBalance,
    hint: strings.alertModeBalanceHint,
  },
  { value: 'float', label: strings.alertModeFloat, hint: strings.alertModeFloatHint },
]

/**
 * Ngưỡng cảnh báo lỗ Float P/L (% Balance, 0 là tắt) và chế độ tính "lỗ đã tăng X%". Chỉ tải khi mở. Đang chạy dự phòng
 * trên Cloudflare thì BE từ chối ghi: hiện đúng thông báo máy chủ trả về.
 */
export function AlertSettingsForm() {
  const query = useAlertSettings(true)
  const save = useSaveAlertSettings()
  const thresholdId = useId()
  const modeName = useId()
  const [text, setText] = useState<string | null>(null)
  const [mode, setMode] = useState<GrowthMode | null>(null)
  const [invalid, setInvalid] = useState(false)

  if (query.isPending) return <p className="px-3 py-6 text-sm text-muted">{strings.alertLoading}</p>
  if (query.isError || !query.data) {
    return (
      <div className="px-3 py-6 text-sm text-loss">
        <p>{strings.alertLoadError}</p>
        <Button size="sm" className="mt-2" onClick={() => query.refetch()}>
          {strings.retry}
        </Button>
      </div>
    )
  }

  const value = text ?? showPct(query.data.loss_pct)
  const current = mode ?? query.data.growth_mode

  const submit = () => {
    const pct = parseLossPct(value)
    if (pct === null) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    save.mutate(
      { loss_pct: pct, growth_mode: current },
      {
        onSuccess: () => {
          setText(null)
          setMode(null)
        },
      },
    )
  }

  return (
    <div className="space-y-4 px-3 py-3">
      <div>
        <label htmlFor={thresholdId} className="mb-1 block text-sm font-medium text-ink">
          {strings.alertThresholdLabel}
        </label>
        <input
          id={thresholdId}
          inputMode="decimal"
          className={inputClass}
          value={value}
          aria-invalid={invalid}
          aria-describedby={`${thresholdId}-hint`}
          onChange={(e) => {
            setText(e.target.value)
            setInvalid(false)
            save.reset()
          }}
        />
        <p id={`${thresholdId}-hint`} className="mt-1 text-xs text-muted">
          {strings.alertThresholdHint}
        </p>
        {invalid && (
          <p role="alert" className="mt-1 text-xs text-loss">
            {strings.alertInvalid}
          </p>
        )}
      </div>

      <fieldset>
        <legend className="mb-1 text-sm font-medium text-ink">{strings.alertModeLabel}</legend>
        <div className="space-y-2">
          {MODES.map((m) => (
            <label key={m.value} className="flex cursor-pointer items-start gap-2">
              <input
                type="radio"
                name={modeName}
                value={m.value}
                checked={current === m.value}
                className="mt-1"
                onChange={() => {
                  setMode(m.value)
                  save.reset()
                }}
              />
              <span>
                <span className="block text-sm text-ink">{m.label}</span>
                <span className="block text-xs text-muted">{m.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex items-center gap-3">
        <Button variant="primary" disabled={save.isPending} onClick={submit}>
          {save.isPending ? strings.alertSaving : strings.alertSave}
        </Button>
        {save.isSuccess && (
          <span role="status" className="text-sm text-gain">
            {strings.alertSaved}
          </span>
        )}
        {save.isError && (
          <span role="alert" className="text-sm text-loss">
            {save.error instanceof Error && save.error.message
              ? save.error.message
              : strings.alertSaveFailed}
          </span>
        )}
      </div>
    </div>
  )
}
