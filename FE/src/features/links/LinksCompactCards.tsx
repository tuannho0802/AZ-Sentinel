import { Link } from 'wouter'
import { MobileCard, MobileCardList } from '../../components/MobileCard'
import { Delta, Money } from '../../components/Money'
import { strings } from '../../lib/strings'
import type { LinkRow } from './links-view'
import { rowLook } from './row-look'
import { healthLabel } from './StatusBadge'

/**
 * Thẻ gọn trên điện thoại, để quét nhanh nhiều tài khoản trong một lần vuốt. Chỉ giữ: số tài khoản cùng sàn và tên
 * (một nhóm), rồi Balance và Lãi/lỗ đang mở, rồi VPS. Cả thẻ là một liên kết sang trang chi tiết. Tình trạng vẫn có
 * vạch màu bên trái; chữ tình trạng chỉ để trình đọc màn hình (kiểu chi tiết mới hiện huy hiệu).
 */
function LinksCompactCard({ row }: { row: LinkRow }) {
  const { link: l, health } = row
  const currency = l.account?.currency ?? null
  const look = rowLook[health]
  return (
    <MobileCard
      dense
      stripe={look.stripe}
      tone={look.bg}
      head={
        <Link
          href={`/links/${l.id}`}
          className="min-w-0 flex-1 after:absolute after:inset-0 after:content-['']"
        >
          <span className="sr-only">{strings.viewDetail} </span>
          {l.account ? (
            <>
              <span className="num block text-base leading-tight font-semibold">
                {l.account.login}
              </span>
              <span className="block truncate text-xs text-muted">
                {l.account.server}
                {l.account.name ? ` · ${l.account.name}` : ''}
              </span>
            </>
          ) : (
            <span className="text-muted">{strings.unbound}</span>
          )}
          <span className="sr-only"> — {healthLabel(health, l.account !== null)}</span>
        </Link>
      }
    >
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        <div className="min-w-0">
          <dt className="text-xs text-muted">{strings.colBalance}</dt>
          <dd className="min-w-0 text-sm break-words">
            <Money value={l.state?.balance} currency={currency} />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted">{strings.colPl}</dt>
          <dd className="min-w-0 text-sm break-words">
            <Delta value={l.state?.floating_pl} currency={currency} />
          </dd>
        </div>
        <div className="col-span-2 flex min-w-0 items-baseline gap-2">
          <dt className="text-xs text-muted">{strings.colVps}</dt>
          <dd className="min-w-0 truncate text-sm font-medium">
            {l.vps_name || <span className="text-subtle">—</span>}
          </dd>
        </div>
      </dl>
    </MobileCard>
  )
}

export function LinksCompactCards({ rows }: { rows: LinkRow[] }) {
  return (
    <MobileCardList label={strings.linksPageTitle}>
      {rows.map((row) => (
        <LinksCompactCard key={row.link.id} row={row} />
      ))}
    </MobileCardList>
  )
}
