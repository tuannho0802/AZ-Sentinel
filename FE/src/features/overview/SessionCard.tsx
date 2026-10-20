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
          <dd className="text-gray-600">{me.data.email}</dd>
          <dd className="text-gray-600">{strings.roles[me.data.role]}</dd>
        </dl>
      )}
    </Card>
  )
}
