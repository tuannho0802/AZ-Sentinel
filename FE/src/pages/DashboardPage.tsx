import { AppShell } from '../components/AppShell'
import { ApiStatusCard } from '../features/overview/ApiStatusCard'
import { LinksCard } from '../features/overview/LinksCard'
import { SessionCard } from '../features/overview/SessionCard'
import { ServerStatusCard } from '../features/server/ServerStatusCard'
import { strings } from '../lib/strings'

export function DashboardPage() {
  return (
    <AppShell>
      <h1 className="text-xl font-semibold">{strings.overviewTitle}</h1>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <ApiStatusCard />
        <SessionCard />
        <LinksCard />
        <ServerStatusCard />
      </div>
    </AppShell>
  )
}
