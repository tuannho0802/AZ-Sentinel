import { Link } from 'wouter'
import { Field, MobileCard, MobileCardList } from '../../components/MobileCard'
import { Delta, Money } from '../../components/Money'
import { useCardMode } from '../../lib/card-mode'
import { formatRelative } from '../../lib/format'
import { strings } from '../../lib/strings'
import { useIsWide } from '../../lib/use-media'
import { useNow } from '../../lib/use-now'
import { CardModeToggle } from './CardModeToggle'
import { LinksCompactCards } from './LinksCompactCards'
import type { LinkRow } from './links-view'
import { RotateKeyButton } from './RotateKeyButton'
import { rowLook } from './row-look'
import { StatusBadge } from './StatusBadge'
import { VpsNameCell } from './VpsNameCell'

const th = 'px-3 py-2.5 text-left text-xs font-medium whitespace-nowrap text-muted'
const thNum = `${th} !text-right`
const td = 'px-3 py-3 align-middle'

function LinksTableWide({ rows }: { rows: LinkRow[] }) {
  const now = useNow()
  // Cột chủ sở hữu chỉ có khi API trả `owner` (danh sách của quản trị viên).
  const showOwner = rows.some((r) => r.link.owner !== undefined)
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full min-w-[56rem] border-collapse text-sm">
        <thead className="border-b border-line bg-raised">
          <tr>
            <th className={th}>{strings.colPresence}</th>
            <th className={th}>{strings.colAccount}</th>
            <th className={`${th} hidden xl:table-cell`}>{strings.colAccountName}</th>
            <th className={th}>{strings.colVps}</th>
            {showOwner && <th className={th}>{strings.colOwner}</th>}
            <th className={thNum}>{strings.colBalance}</th>
            <th className={thNum}>{strings.colEquity}</th>
            <th className={thNum}>{strings.colPl}</th>
            <th className={th}>{strings.colLastSeen}</th>
            <th className={th}>
              <span className="sr-only">{strings.actionsTitle}</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map(({ link: l, health, liveState }) => {
            const currency = l.account?.currency ?? null
            const look = rowLook[health]
            return (
              <tr key={l.id} className={`hover:bg-raised/60 ${look.bg}`}>
                <td className={`${td} border-l-[3px] ${look.stripe}`}>
                  <StatusBadge health={health} hasAccount={l.account !== null} />
                </td>
                <td className={td}>
                  {l.account ? (
                    <>
                      <div className="num font-medium">{l.account.login}</div>
                      <div className="text-xs text-muted">{l.account.server}</div>
                    </>
                  ) : (
                    <span className="text-muted">{strings.unbound}</span>
                  )}
                </td>
                <td className={`${td} hidden xl:table-cell`}>{l.account?.name || '—'}</td>
                <td className={td}>
                  <VpsNameCell linkId={l.id} value={l.vps_name} />
                </td>
                {showOwner && (
                  <td className={td}>
                    {l.owner ? (
                      (l.owner.name ?? `#${l.owner.id}`)
                    ) : (
                      <span className="text-muted">{strings.ownerNone}</span>
                    )}
                  </td>
                )}
                <td className={`${td} text-right whitespace-nowrap`}>
                  <Money value={l.state?.balance} currency={currency} />
                </td>
                <td className={`${td} text-right font-medium whitespace-nowrap`}>
                  <Money value={l.state?.equity} currency={currency} />
                </td>
                <td className={`${td} text-right whitespace-nowrap`}>
                  <Delta value={l.state?.floating_pl} currency={currency} />
                </td>
                <td className={`${td} whitespace-nowrap`}>
                  {liveState === 'live' ? (
                    <span className="text-live">{strings.lastSeenLive}</span>
                  ) : l.state ? (
                    <span className="text-muted">{formatRelative(l.state.last_seen_at, now)}</span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className={`${td} whitespace-nowrap`}>
                  <div className="flex items-center justify-end gap-1.5">
                    <span className="num mr-1 text-xs text-subtle">#{l.id}</span>
                    <Link
                      href={`/links/${l.id}`}
                      className="inline-flex h-7 items-center rounded-md border border-line-strong bg-surface px-2.5 text-[0.8125rem] font-medium text-ink transition-colors hover:bg-raised"
                    >
                      {strings.viewDetail}
                    </Link>
                    <RotateKeyButton linkId={l.id} variant="ghost" />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Điện thoại, kiểu chi tiết: mỗi tài khoản là một thẻ đủ thông tin (trạng thái, số TK, VPS, chủ sở hữu,
 * Balance/Equity/Lãi-lỗ, lần nhận gần nhất) và hai nút thao tác cao dễ chạm. Không có thanh cuộn ngang.
 */
function LinksDetailedCards({ rows }: { rows: LinkRow[] }) {
  const now = useNow()
  const showOwner = rows.some((r) => r.link.owner !== undefined)
  return (
    <MobileCardList label={strings.linksPageTitle}>
      {rows.map(({ link: l, health, liveState }) => {
        const currency = l.account?.currency ?? null
        const look = rowLook[health]
        return (
          <MobileCard
            key={l.id}
            stripe={look.stripe}
            tone={look.bg}
            head={
              <>
                <div className="min-w-0">
                  {l.account ? (
                    <>
                      <div className="num text-base leading-tight font-semibold">
                        {l.account.login}
                      </div>
                      <div className="truncate text-xs text-muted">
                        {l.account.server}
                        {l.account.name ? ` · ${l.account.name}` : ''}
                      </div>
                    </>
                  ) : (
                    <span className="text-muted">{strings.unbound}</span>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <StatusBadge health={health} hasAccount={l.account !== null} />
                  <span className="num text-xs text-subtle">#{l.id}</span>
                </div>
              </>
            }
            actions={
              <>
                <Link
                  href={`/links/${l.id}`}
                  className="inline-flex h-9 flex-1 items-center justify-center rounded-md border border-line-strong bg-surface px-3.5 text-sm font-medium text-ink transition-colors hover:bg-raised"
                >
                  {strings.viewDetail}
                </Link>
                <RotateKeyButton linkId={l.id} />
              </>
            }
          >
            <dl className="grid grid-cols-3 gap-x-3 gap-y-3">
              <Field label={strings.colBalance}>
                <Money value={l.state?.balance} currency={currency} />
              </Field>
              <Field label={strings.colEquity} className="font-medium">
                <Money value={l.state?.equity} currency={currency} />
              </Field>
              <Field label={strings.colPl}>
                <Delta value={l.state?.floating_pl} currency={currency} />
              </Field>
              <Field label={strings.colVps} className="col-span-2">
                <VpsNameCell linkId={l.id} value={l.vps_name} />
              </Field>
              <Field label={strings.colLastSeen}>
                {liveState === 'live' ? (
                  <span className="text-live">{strings.lastSeenLive}</span>
                ) : l.state ? (
                  <span className="text-muted">{formatRelative(l.state.last_seen_at, now)}</span>
                ) : (
                  '—'
                )}
              </Field>
              {showOwner && (
                <Field label={strings.colOwner} className="col-span-3">
                  {l.owner ? (
                    (l.owner.name ?? `#${l.owner.id}`)
                  ) : (
                    <span className="text-muted">{strings.ownerNone}</span>
                  )}
                </Field>
              )}
            </dl>
          </MobileCard>
        )
      })}
    </MobileCardList>
  )
}

/** Điện thoại: nút chọn kiểu thẻ (nhớ lựa chọn) rồi danh sách thẻ gọn hoặc chi tiết. Mặc định thẻ gọn. */
function LinksCards({ rows }: { rows: LinkRow[] }) {
  const [mode, setMode] = useCardMode()
  return (
    <div className="flex flex-col gap-2.5">
      <CardModeToggle mode={mode} onChange={setMode} />
      {mode === 'compact' ? <LinksCompactCards rows={rows} /> : <LinksDetailedCards rows={rows} />}
    </div>
  )
}

/** Máy tính: bảng; điện thoại: thẻ. Chỉ vẽ một bố cục. */
export function LinksTable({ rows }: { rows: LinkRow[] }) {
  return useIsWide() ? <LinksTableWide rows={rows} /> : <LinksCards rows={rows} />
}
