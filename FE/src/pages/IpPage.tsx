import { AppShell } from '../components/AppShell'
import { DevicePanel } from '../features/device/DevicePanel'
import { IpPanel } from '../features/ip/IpPanel'

export function IpPage() {
  return (
    <AppShell>
      <div className="space-y-8">
        <IpPanel />
        <DevicePanel />
      </div>
    </AppShell>
  )
}
