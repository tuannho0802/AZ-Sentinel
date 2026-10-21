import { Card } from '../../components/Card'
import { strings } from '../../lib/strings'
import { useMe } from '../auth/api'

export function SessionCard() {
  const me = useMe()
  return (
    <Card title={strings.sessionTitle}>
      {me.data && (
        <dl className="text-sm">
          <dt className="font-medium">{me.data.display_name}</dt>
          <dd className="text-muted">{me.data.email}</dd>
          <dd className="mt-1.5">
            <span className="rounded-full bg-raised px-2 py-0.5 text-xs font-medium text-muted">
              {strings.roles[me.data.role]}
            </span>
          </dd>
        </dl>
      )}
    </Card>
  )
}
