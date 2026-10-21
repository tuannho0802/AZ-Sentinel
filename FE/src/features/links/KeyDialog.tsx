import { useState } from 'react'
import { Button } from '../../components/Button'
import { Dialog } from '../../components/Dialog'
import { Icon } from '../../components/Icon'
import { inputClass } from '../../components/styles'
import { strings } from '../../lib/strings'
import { GATEWAY_LOCAL_URL, gatewayCloudUrl } from './gateway-url'

type Props = { apiKey: string; onClose: () => void; title?: string; warning?: string }

function CopyRow({
  id,
  label,
  value,
  buttonLabel,
  onCopy,
}: {
  id: string
  label: string
  value: string
  buttonLabel: string
  onCopy: (text: string) => void
}) {
  return (
    <div>
      <label className="block text-sm font-medium" htmlFor={id}>
        {label}
      </label>
      <div className="mt-1 flex gap-2">
        <input
          id={id}
          readOnly
          value={value}
          className={`${inputClass} min-w-0 flex-1 font-mono text-[0.8125rem]`}
          onFocus={(e) => e.currentTarget.select()}
        />
        <Button onClick={() => onCopy(value)}>
          <Icon name="copy" size={14} />
          {buttonLabel}
        </Button>
      </div>
    </div>
  )
}

/** Hiện khóa đúng một lần; khóa chỉ nằm trong state của hộp thoại này. */
export function KeyDialog({
  apiKey,
  onClose,
  title = strings.keyDialogTitle,
  warning = strings.keyDialogWarning,
}: Props) {
  const [message, setMessage] = useState<string | null>(null)

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
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
        {warning}
      </p>
      <div className="mt-4 space-y-3">
        <CopyRow
          id="new-api-key"
          label={strings.keyLabel}
          value={apiKey}
          buttonLabel={strings.copyKey}
          onCopy={copy}
        />
        <CopyRow
          id="gateway-cloud-url"
          label={strings.gatewayCloudUrlLabel}
          value={gatewayCloudUrl()}
          buttonLabel={strings.copyUrl}
          onCopy={copy}
        />
      </div>
      {message && (
        <p role="status" className="mt-2 text-sm text-muted">
          {message}
        </p>
      )}
      <p className="mt-3 text-sm text-muted">{strings.keyDialogSteps(GATEWAY_LOCAL_URL)}</p>
    </Dialog>
  )
}
