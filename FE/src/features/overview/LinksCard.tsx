import { Link } from 'wouter'
import { Card } from '../../components/Card'
import { strings } from '../../lib/strings'

export function LinksCard() {
  return (
    <Card title={strings.linksTitle}>
      <p className="text-sm text-muted">{strings.linksOverviewHint}</p>
      <Link
        href="/links"
        className="mt-3 inline-flex h-9 items-center rounded-md border border-line-strong bg-surface px-3.5 text-sm font-medium transition-colors hover:bg-raised"
      >
        {strings.linksManage}
      </Link>
    </Card>
  )
}
