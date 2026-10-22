import { useState } from 'react'
import { Button } from '../../components/Button'
import { Dialog } from '../../components/Dialog'
import { Icon } from '../../components/Icon'
import { inputClass } from '../../components/styles'
import { strings } from '../../lib/strings'

/** Hiện token đúng một lần; token chỉ nằm trong state của hộp thoại này và có nút sao chép. */
export function TokenSecretDialog({
  token,
  title,
  onClose,
}: {
  token: string
  title: string
  onClose: () => void
}) {
  const [message, setMessage] = useState<string | null>(null)

  async function copy() {
    try {
      await navigator.clipboard.writeText(token)
      setMessage(strings.copied)
    } catch {
      setMessage(strings.copyFailed)
    }
  }

  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={onClose}>
          {strings.close}
        </Button>
      }
    >
      <p
        role="alert"
        className="flex gap-2 rounded-md bg-notice-bg px-3 py-2 text-sm text-notice-ink"
      >
        <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
        {strings.tokenDialogWarning}
      </p>
      <div className="mt-4">
        <label className="block text-sm font-medium" htmlFor="gw-token-secret">
          {strings.tokenFieldLabel}
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id="gw-token-secret"
            readOnly
            value={token}
            className={`${inputClass} min-w-0 flex-1 font-mono text-[0.8125rem]`}
            onFocus={(e) => e.currentTarget.select()}
          />
          <Button onClick={copy}>
            <Icon name="copy" size={14} />
            {strings.tokenCopy}
          </Button>
        </div>
      </div>
      {message && (
        <p role="status" className="mt-2 text-sm text-muted">
          {message}
        </p>
      )}
    </Dialog>
  )
}
