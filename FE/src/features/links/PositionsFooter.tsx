import type { LinkDetail, Position } from '@az-sentinel/shared'
import { Delta, Money } from '../../components/Money'
import { strings } from '../../lib/strings'

type State = NonNullable<LinkDetail['state']>

export type AccountSummary = {
  balance: number | null
  equity: number | null
  margin: number | null
  freeMargin: number | null
  swap: number
  floating: number | null
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Dòng tổng kết dưới bảng lệnh, giống thanh tổng của tab Trade trong MT5.
 * - Balance, Equity, Float P/L lấy từ trạng thái (đã phủ live nếu đang nối).
 * - Margin chỉ đổi khi mở/đóng lệnh nên lấy từ D1; Free margin tính lại `Equity − Margin` theo tick khi đang live
 *   (D1 chỉ ghi tối đa mỗi 60 giây nên số lưu sẽ lệch Equity). Không live thì dùng đúng số đã lưu.
 * - Swap là tổng swap của các lệnh đang mở (lệnh thiếu swap tính 0).
 */
export function summarizeAccount(
  state: State,
  positions: readonly Position[],
  live: boolean,
): AccountSummary {
  const canDerive = live && state.equity !== null && state.margin !== null
  return {
    balance: state.balance,
    equity: state.equity,
    margin: state.margin,
    freeMargin:
      canDerive && state.equity !== null && state.margin !== null
        ? round2(state.equity - state.margin)
        : state.margin_free,
    swap: round2(positions.reduce((sum, p) => sum + (p.swap ?? 0), 0)),
    floating: state.floating_pl,
  }
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-1.5 whitespace-nowrap">
      <dt className="font-semibold">{label}:</dt>
      <dd>{children}</dd>
    </div>
  )
}

export function PositionsFooter({
  state,
  positions,
  live,
  currency,
}: {
  state: State
  positions: readonly Position[]
  live: boolean
  currency: string | null
}) {
  const t = summarizeAccount(state, positions, live)
  return (
    <dl
      aria-label={strings.positionsSummary}
      className="mt-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1.5 rounded-md bg-raised px-3 py-2.5 text-sm"
    >
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5">
        <Item label={strings.fieldBalance}>
          <Money value={t.balance} currency={currency} />
        </Item>
        <Item label={strings.fieldEquity}>
          <Money value={t.equity} currency={currency} />
        </Item>
        <Item label={strings.fieldMargin}>
          <Money value={t.margin} currency={currency} />
        </Item>
        <Item label={strings.fieldMarginFree}>
          <Money value={t.freeMargin} currency={currency} />
        </Item>
        <Item label={strings.fieldSwap}>
          <Delta value={t.swap} currency={currency} />
        </Item>
      </div>
      <Item label={strings.fieldFloatTotal}>
        <Delta value={t.floating} currency={currency} className="font-semibold" />
      </Item>
    </dl>
  )
}
