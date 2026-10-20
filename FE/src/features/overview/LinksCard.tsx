import { Link } from 'wouter'
import { Card } from '../../components/Card'
import { strings } from '../../lib/strings'

export function LinksCard() {
  return (
    <Card title={strings.linksTitle}>
      <p className="text-sm text-gray-600">{strings.linksOverviewHint}</p>
      {import.meta.env.DEV && (
        <Link href="/links" className="mt-2 inline-block underline">
          {strings.linksManage}
        </Link>
      )}
    </Card>
  )
}
