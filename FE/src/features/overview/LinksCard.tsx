import { Card } from '../../components/Card'
import { strings } from '../../lib/strings'

/** Trạng thái rỗng (Rules FE mục 8); danh sách thật có ở Part 3. */
export function LinksCard() {
  return (
    <Card title={strings.linksTitle}>
      <p>{strings.linksEmpty}</p>
      <p className="text-sm text-gray-500">{strings.linksEmptyHint}</p>
    </Card>
  )
}
