import { Link } from 'wouter'
import { Card } from '../../components/Card'
import { Money } from '../../components/Money'
import { strings } from '../../lib/strings'
import { useIsWide } from '../../lib/use-media'
import { useLinks } from '../links/api'
import { type LinkRow, useLinkRows } from '../links/links-view'
import { StatusBadge } from '../links/StatusBadge'

const BTN =
  'inline-flex h-9 items-center justify-center rounded-md border border-line-strong bg-surface px-3.5 text-sm font-medium transition-colors hover:bg-raised'

/** Số tài khoản hiện ở Tổng quan (cập nhật gần nhất); phần còn lại xem ở trang Liên kết EA. */
export const OVERVIEW_ACCOUNT_LIMIT = 8

/** Mới cập nhật nhất lên đầu; chưa có dữ liệu thì xuống cuối. */
export function latestFirst(rows: LinkRow[]): LinkRow[] {
  return [...rows].sort(
    (a, b) => (b.link.state?.last_seen_at ?? -1) - (a.link.state?.last_seen_at ?? -1),
  )
}

function Who({ row }: { row: LinkRow }) {
  const a = row.link.account
  if (!a) return <span className="text-muted">{strings.unbound}</span>
  return (
    <>
      <div className="truncate font-medium">{a.name || a.login}</div>
      <div className="truncate text-xs text-muted">
        {a.broker || a.server} · <span className="num">{a.login}</span>
      </div>
    </>
  )
}

const Vps = ({ row }: { row: LinkRow }) =>
  row.link.vps_name ? (
    <span className="font-medium">{row.link.vps_name}</span>
  ) : (
    <span className="text-subtle">—</span>
  )

/**
 * Tổng quan: trạng thái Online/Offline của các tài khoản MT5 đang kết nối (tên + broker, VPS, Balance),
 * chỉ vài tài khoản cập nhật gần nhất; nút "Xem thêm" và "Quản lý liên kết EA" sang trang Liên kết EA
 * (đã gộp thẻ "Liên kết EA" cũ vào đây). Điện thoại: danh sách xếp dọc.
 */
export function AccountsCard() {
  const links = useLinks()
  const wide = useIsWide()
  const rows = latestFirst(useLinkRows(links.data?.links, false))
  const shown = rows.slice(0, OVERVIEW_ACCOUNT_LIMIT)
  const more = rows.length - shown.length

  return (
    <Card title={strings.accountsCardTitle}>
      {links.isPending && <p className="text-sm text-muted">{strings.linksLoading}</p>}
      {links.isError && <p className="text-sm text-muted">{strings.accountsCardError}</p>}
      {links.isSuccess && rows.length === 0 && (
        <p className="text-sm text-muted">
          {strings.accountsCardEmpty} {strings.linksOverviewHint}
        </p>
      )}
      {shown.length > 0 &&
        (wide ? (
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted">
                <tr>
                  <th className="px-4 py-1.5 font-medium">{strings.colPresence}</th>
                  <th className="px-4 py-1.5 font-medium">{strings.accountsColAccount}</th>
                  <th className="px-4 py-1.5 font-medium">{strings.colVps}</th>
                  <th className="px-4 py-1.5 text-right font-medium">{strings.colBalance}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.link.id} className="border-t border-line align-middle">
                    <td className="px-4 py-2">
                      <StatusBadge health={r.health} hasAccount={r.link.account !== null} />
                    </td>
                    <td className="max-w-72 px-4 py-2">
                      <Who row={r} />
                    </td>
                    <td className="px-4 py-2">
                      <Vps row={r} />
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <Money
                        value={r.link.state?.balance}
                        currency={r.link.account?.currency ?? null}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <ul aria-label={strings.accountsCardTitle} className="-mx-4 divide-y divide-line">
            {shown.map((r) => (
              <li key={r.link.id} className="space-y-1.5 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Who row={r} />
                  </div>
                  <StatusBadge health={r.health} hasAccount={r.link.account !== null} />
                </div>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-muted">
                    {strings.colVps}: <Vps row={r} />
                  </span>
                  <span className="whitespace-nowrap">
                    <Money
                      value={r.link.state?.balance}
                      currency={r.link.account?.currency ?? null}
                    />
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ))}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {more > 0 && (
          <Link href="/links" className={`${BTN} border-accent-text/50 text-accent-text`}>
            {strings.accountsMore} ({more})
          </Link>
        )}
        <Link href="/links" className={BTN}>
          {strings.linksManage}
        </Link>
      </div>
    </Card>
  )
}
