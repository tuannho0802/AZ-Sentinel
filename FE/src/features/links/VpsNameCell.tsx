import { normalizeVpsName, VPS_NAME_MAX } from '@az-sentinel/shared'
import { useState } from 'react'
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
        {value ? <span>{value}</span> : <span className="text-gray-400">—</span>}
        <button
          type="button"
          className="text-xs text-gray-500 underline"
          aria-label={`${strings.vpsNameEdit} ${strings.fieldVpsName} #${linkId}`}
          onClick={start}
        >
          {strings.vpsNameEdit}
        </button>
      </span>
    )
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <input
        // biome-ignore lint/a11y/noAutofocus: người dùng vừa bấm "Sửa", đưa con trỏ vào ô nhập
        autoFocus
        aria-label={`${strings.fieldVpsName} #${linkId}`}
        className="w-36 rounded border px-2 py-0.5 text-sm"
        maxLength={VPS_NAME_MAX}
        value={draft}
        disabled={save.isPending}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') setEditing(false)
        }}
      />
      <button
        type="button"
        className="rounded border px-2 py-0.5 text-xs disabled:opacity-60"
        disabled={save.isPending}
        onClick={submit}
      >
        {strings.vpsNameSave}
      </button>
      <button
        type="button"
        className="rounded border px-2 py-0.5 text-xs"
        disabled={save.isPending}
        onClick={() => setEditing(false)}
      >
        {strings.vpsNameCancel}
      </button>
      {save.isError && (
        <span role="alert" className="text-xs text-red-600">
          {strings.vpsNameFailed}
        </span>
      )}
    </span>
  )
}
