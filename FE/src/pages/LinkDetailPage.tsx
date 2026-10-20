import { useParams } from 'wouter'
import { AppShell } from '../components/AppShell'
import { LinkDetailPanel } from '../features/links/LinkDetailPanel'
import { NotFoundPage } from './NotFoundPage'

export function LinkDetailPage() {
  const params = useParams<{ id: string }>()
  if (!/^[1-9][0-9]{0,9}$/.test(params.id)) return <NotFoundPage />
  return (
    <AppShell>
      <LinkDetailPanel id={Number(params.id)} />
    </AppShell>
  )
}
