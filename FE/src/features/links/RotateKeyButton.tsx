import { useState } from 'react'
import { strings } from '../../lib/strings'
import { useRotateKey } from './api'
import { KeyDialog } from './KeyDialog'

/**
 * Cấp lại khóa rồi hiện hộp thoại có nút sao chép. DB chỉ lưu băm nên không lấy lại được
 * khóa cũ; khóa mới chỉ nằm trong state của component này cho tới khi đóng hộp thoại.
 */
export function RotateKeyButton({
  linkId,
  disabled = false,
}: {
  linkId: number
  disabled?: boolean
}) {
  const rotate = useRotateKey(linkId)
  const [revealedKey, setRevealedKey] = useState<string | null>(null)

  function onClick() {
    if (!window.confirm(strings.confirmRotate)) return
    rotate.mutate(undefined, {
      onSuccess: (res) => {
        setRevealedKey(res.api_key)
        rotate.reset()
      },
    })
  }

  return (
    <>
      <button
        type="button"
        className="rounded border px-3 py-1 disabled:opacity-60"
        disabled={disabled || rotate.isPending}
        onClick={onClick}
      >
        {rotate.isPending ? strings.rotating : strings.rotateKey}
      </button>
      {rotate.isError && (
        <span role="alert" className="ml-2 text-xs text-red-600">
          {strings.rotateFailed}
        </span>
      )}
      {revealedKey && (
        <KeyDialog
          apiKey={revealedKey}
          title={`${strings.rotateDialogTitle} #${linkId}`}
          warning={strings.rotateDialogWarning}
          onClose={() => setRevealedKey(null)}
        />
      )}
    </>
  )
}
