import type { LinkSummary } from '@az-sentinel/shared'
import { useLocation } from 'wouter'
import { Button } from '../../components/Button'
import { strings } from '../../lib/strings'
import { useDeleteLink, useSetLinkStatus, useUnbindLink } from './api'
import { RotateKeyButton } from './RotateKeyButton'

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
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={busy} onClick={toggle}>
          {link.status === 'active' ? strings.actDisable : strings.actEnable}
        </Button>
        <RotateKeyButton linkId={link.id} disabled={busy} />
        <Button
          disabled={busy || !link.account}
          onClick={() => window.confirm(strings.confirmUnbind) && unbind.mutate()}
        >
          {strings.actUnbind}
        </Button>
        <Button
          variant="danger"
          disabled={busy}
          onClick={() => {
            if (window.confirm(strings.confirmDelete))
              del.mutate(undefined, { onSuccess: () => navigate('/links') })
          }}
        >
          {strings.actDelete}
        </Button>
      </div>
      {failed && (
        <p role="alert" className="mt-2 text-sm text-loss">
          {strings.actionFailed}
        </p>
      )}
    </div>
  )
}