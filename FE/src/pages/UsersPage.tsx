import { AppShell } from '../components/AppShell'
import { UsersPanel } from '../features/users/UsersPanel'

export function UsersPage() {
  return (
    <AppShell>
      <UsersPanel />
    </AppShell>
  )
}
