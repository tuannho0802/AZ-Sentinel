import { useState } from 'react'
import { strings } from '../../lib/strings'
import { ingestUrl } from './ingest-url'

type Props = { apiKey: string; onClose: () => void; title?: string; warning?: string }

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
    <div className="fixed inset-0 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="key-dialog-title"
        className="w-full max-w-lg rounded-lg bg-white p-5 shadow-lg"
      >
        <h2 id="key-dialog-title" className="text-lg font-semibold">
          {title}
        </h2>
        <p role="alert" className="mt-2 rounded bg-yellow-50 p-2 text-sm text-yellow-800">
          {warning}
        </p>

        <label className="mt-4 block text-sm font-medium" htmlFor="new-api-key">
          {strings.keyLabel}
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id="new-api-key"
            readOnly
            value={apiKey}
            className="min-w-0 flex-1 rounded border px-2 py-1 font-mono text-sm"
            onFocus={(e) => e.currentTarget.select()}
          />
          <button type="button" className="rounded border px-3 py-1" onClick={() => copy(apiKey)}>
            {strings.copyKey}
          </button>
        </div>

        <label className="mt-3 block text-sm font-medium" htmlFor="ingest-url">
          {strings.ingestUrlLabel}
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id="ingest-url"
            readOnly
            value={ingestUrl()}
            className="min-w-0 flex-1 rounded border px-2 py-1 font-mono text-sm"
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            type="button"
            className="rounded border px-3 py-1"
            onClick={() => copy(ingestUrl())}
          >
            {strings.copyUrl}
          </button>
        </div>

        {message && (
          <p role="status" className="mt-2 text-sm text-gray-600">
            {message}
          </p>
        )}
        <p className="mt-3 text-sm text-gray-600">{strings.keyDialogSteps}</p>

        <div className="mt-4 text-right">
          <button
            type="button"
            className="rounded bg-gray-900 px-4 py-1.5 text-white"
            onClick={onClose}
          >
            {strings.close}
          </button>
        </div>
      </div>
    </div>
  )
}
