import { normalizeVpsName, VPS_NAME_MAX } from '@az-sentinel/shared'
import { useState } from 'react'
import { Button } from '../../components/Button'
import { inputSmClass } from '../../components/styles'
import { strings } from '../../lib/strings'
import { useSetVpsName } from './api'

/**
 * Tên VPS do người dùng tự nhập (tài khoản này đang chạy ở VPS nào). Hiển thị dạng văn bản thuần;
 * bấm "Sửa" để đổi ngay tại chỗ, Enter hoặc "Lưu" để lưu, Esc hoặc "Hủy" để bỏ. Để trống rồi lưu
 * là xóa tên.
 */
export function VpsNameCell({ linkId, value }: { linkId: number; value: string | null }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const save = useSetVpsName(linkId)

  function start() {
    setDraft(value ?? '')
    save.reset()
    setEditing(true)
  }

  function submit() {
    const next = normalizeVpsName(draft)
    if (next === value) {
      setEditing(false)
      return
    }
    save.mutate(next, { onSuccess: () => setEditing(false) })
  }

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-2">
        {value ? (
          <span className="font-medium">{value}</span>
        ) : (
          <span className="text-subtle">—</span>
        )}
        <button
          type="button"
          className="rounded px-1 text-xs text-muted underline decoration-line-strong underline-offset-2 hover:text-ink"
          aria-label={`${strings.vpsNameEdit} ${strings.fieldVpsName} #${linkId}`}
          onClick={start}
        >
          {strings.vpsNameEdit}
        </button>
      </span>
    )
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <input
        // biome-ignore lint/a11y/noAutofocus: người dùng vừa bấm "Sửa", đưa con trỏ vào ô nhập
        autoFocus
        aria-label={`${strings.fieldVpsName} #${linkId}`}
        className={`${inputSmClass} w-36`}
        maxLength={VPS_NAME_MAX}
        value={draft}
        disabled={save.isPending}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') setEditing(false)
        }}
      />
      <Button size="sm" variant="primary" disabled={save.isPending} onClick={submit}>
        {strings.vpsNameSave}
      </Button>
      <Button size="sm" disabled={save.isPending} onClick={() => setEditing(false)}>
        {strings.vpsNameCancel}
      </Button>
      {save.isError && (
        <span role="alert" className="text-xs text-loss">
          {strings.vpsNameFailed}
        </span>
      )}
    </span>
  )
}