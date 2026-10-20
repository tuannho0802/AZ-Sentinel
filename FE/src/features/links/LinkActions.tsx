import type { LinkSummary } from '@az-sentinel/shared'
import { useLocation } from 'wouter'
import { strings } from '../../lib/strings'
import { useDeleteLink, useSetLinkStatus, useUnbindLink } from './api'

/** Thao tác nguy hiểm đều có xác nhận nêu rõ hậu quả (Rules FE mục 8). */
export function LinkActions({ link }: { link: LinkSummary }) {
  const [, navigate] = useLocation()
  const setStatus = useSetLinkStatus(link.id)
  const unbind = useUnbindLink(link.id)
  const del = useDeleteLink(link.id)
  const busy = setStatus.isPending || unbind.isPending || del.isPending
  const failed = setStatus.isError || unbind.isError || del.isError

  function toggle() {
    if (link.status === 'active') {
      if (!window.confirm(strings.confirmDisable)) return
      setStatus.mutate('disabled')
    } else {
      setStatus.mutate('active')
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded border px-3 py-1 disabled:opacity-60"
          disabled={busy}
          onClick={toggle}
        >
          {link.status === 'active' ? strings.actDisable : strings.actEnable}
        </button>
        <button
          type="button"
          className="rounded border px-3 py-1 disabled:opacity-60"
          disabled={busy || !link.account}
          onClick={() => window.confirm(strings.confirmUnbind) && unbind.mutate()}
        >
          {strings.actUnbind}
        </button>
        <button
          type="button"
          className="rounded border border-red-300 px-3 py-1 text-red-700 disabled:opacity-60"
          disabled={busy}
          onClick={() => {
            if (window.confirm(strings.confirmDelete))
              del.mutate(undefined, { onSuccess: () => navigate('/links') })
          }}
        >
          {strings.actDelete}
        </button>
      </div>
      {failed && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {strings.actionFailed}
        </p>
      )}
    </div>
  )
}
