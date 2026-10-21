import { useState } from 'react'
import { Button } from '../../components/Button'
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
  variant = 'secondary',
}: {
  linkId: number
  disabled?: boolean
  variant?: 'secondary' | 'ghost'
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
      <Button
        size={variant === 'ghost' ? 'sm' : 'md'}
        variant={variant}
        disabled={disabled || rotate.isPending}
        onClick={onClick}
      >
        {rotate.isPending ? strings.rotating : strings.rotateKey}
      </Button>
      {rotate.isError && (
        <span role="alert" className="text-xs text-loss">
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
