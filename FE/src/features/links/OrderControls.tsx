import {
  CLOSE_ALL_FILTERS,
  matchesCloseAll,
  type Position,
  pendingStopsOk,
  SYMBOL_RE,
  type TradeRequest,
} from '@az-sentinel/shared'
import { useState } from 'react'
import { Button } from '../../components/Button'
import { Dialog } from '../../components/Dialog'
import { inputClass } from '../../components/styles'
import { strings } from '../../lib/strings'
import { useSendTrade } from './api'
import { errorText, parseStop, toNum, TradeOutcome } from './TradeControls'

/**
 * Giao dịch từ xa Pha 2: đặt lệnh mới (market, limit, stop kèm SL/TP) và đóng hàng loạt (tất cả, lãi, lỗ,
 * Buy, Sell). Mọi lệnh qua hộp thoại xác nhận; kết quả là retcode thật của MT5 qua `TradeOutcome`.
 * Đặt lệnh mới cần EA bật thêm `InpAllowRemoteOpen`; đóng hàng loạt chỉ cần `InpAllowRemoteTrading`.
 */

type OrderKind = 'market' | 'limit' | 'stop'
type Side = 'buy' | 'sell'
type Filter = (typeof CLOSE_ALL_FILTERS)[number]

const KIND_LABEL: Record<OrderKind, string> = {
  market: strings.orderKindMarket,
  limit: strings.orderKindLimit,
  stop: strings.orderKindStop,
}

const FILTER_LABEL: Record<Filter, string> = {
  all: strings.closeAllFilterAll,
  profit: strings.closeAllFilterProfit,
  loss: strings.closeAllFilterLoss,
  buy: strings.closeAllFilterBuy,
  sell: strings.closeAllFilterSell,
}

/** Nhóm nút chọn một giá trị (dạng tab), có `aria-pressed` để đọc màn hình hiểu. */
function Choice<T extends string>({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; text: string }[]
  disabled: boolean
  onChange: (v: T) => void
}) {
  return (
    <div className="mb-3 text-sm">
      <span className="text-muted">{label}</span>
      <div className="mt-1 flex gap-1.5">
        {options.map((o) => (
          <Button
            key={o.value}
            size="sm"
            variant={value === o.value ? 'primary' : 'secondary'}
            aria-pressed={value === o.value}
            disabled={disabled}
            onClick={() => onChange(o.value)}
          >
            {o.text}
          </Button>
        ))}
      </div>
    </div>
  )
}

function OrderDialog({
  linkId,
  defaultSymbol,
  onClose,
}: {
  linkId: number
  defaultSymbol: string
  onClose: () => void
}) {
  const send = useSendTrade(linkId)
  const [kind, setKind] = useState<OrderKind>('market')
  const [side, setSide] = useState<Side>('buy')
  const [symbol, setSymbol] = useState(defaultSymbol)
  const [volume, setVolume] = useState('')
  const [price, setPrice] = useState('')
  const [sl, setSl] = useState('')
  const [tp, setTp] = useState('')
  const [invalid, setInvalid] = useState<string | null>(null)
  const cmdId = send.data?.cmd_id ?? null
  const sent = send.isPending || cmdId !== null
  const pending = kind !== 'market'

  function submit() {
    const sym = symbol.trim()
    if (!SYMBOL_RE.test(sym)) return setInvalid(strings.orderInvalidSymbol)
    const vol = toNum(volume)
    if (volume.trim() === '' || !Number.isFinite(vol) || vol <= 0) {
      return setInvalid(strings.orderInvalidVolume)
    }
    const s = parseStop(sl)
    const t = parseStop(tp)
    if (Number.isNaN(s) || Number.isNaN(t)) return setInvalid(strings.tradeInvalidStops)

    let req: TradeRequest
    if (kind === 'market') {
      req = { op: 'market', symbol: sym, side, volume: vol, sl: s, tp: t }
    } else {
      const px = toNum(price)
      if (price.trim() === '' || !Number.isFinite(px) || px <= 0) {
        return setInvalid(strings.orderInvalidPrice)
      }
      const pk = `${side}_${kind}` as const
      if (!pendingStopsOk(pk, px, s, t)) return setInvalid(strings.orderInvalidStopSide)
      req = { op: 'pending', symbol: sym, kind: pk, volume: vol, price: px, sl: s, tp: t }
    }
    setInvalid(null)
    send.mutate(req)
  }

  const summary = strings.orderSummary(
    KIND_LABEL[kind],
    side === 'buy' ? strings.orderSideBuy : strings.orderSideSell,
    volume.trim(),
    symbol.trim(),
    pending ? price.trim() : '',
  )

  return (
    <Dialog
      title={strings.orderDlgTitle}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{sent ? strings.tradeCloseDlg : strings.tradeCancel}</Button>
          {!sent && (
            <Button variant="primary" onClick={submit}>
              {strings.orderSubmit}
            </Button>
          )}
        </>
      }
    >
      <p className="num mb-3 rounded-md bg-raised px-3 py-2 text-sm font-medium">{summary}</p>

      <Choice
        label={strings.orderKindLabel}
        value={kind}
        disabled={sent}
        onChange={setKind}
        options={[
          { value: 'market', text: strings.orderKindMarket },
          { value: 'limit', text: strings.orderKindLimit },
          { value: 'stop', text: strings.orderKindStop },
        ]}
      />
      <Choice
        label={strings.orderSideLabel}
        value={side}
        disabled={sent}
        onChange={setSide}
        options={[
          { value: 'buy', text: strings.orderSideBuy },
          { value: 'sell', text: strings.orderSideSell },
        ]}
      />

      <div className="mb-3 grid grid-cols-2 gap-3 text-sm">
        <label className="block">
          <span className="text-muted">{strings.orderSymbolLabel}</span>
          <input
            className={`${inputClass} mt-1`}
            value={symbol}
            disabled={sent}
            onChange={(e) => setSymbol(e.target.value)}
            autoCapitalize="off"
            spellCheck={false}
          />
        </label>
        <label className="block">
          <span className="text-muted">{strings.orderVolumeLabel}</span>
          <input
            className={`${inputClass} num mt-1`}
            inputMode="decimal"
            value={volume}
            disabled={sent}
            onChange={(e) => setVolume(e.target.value)}
          />
        </label>
        {pending && (
          <label className="col-span-2 block">
            <span className="text-muted">{strings.orderPriceLabel}</span>
            <input
              className={`${inputClass} num mt-1`}
              inputMode="decimal"
              value={price}
              disabled={sent}
              onChange={(e) => setPrice(e.target.value)}
            />
          </label>
        )}
        <label className="block">
          <span className="text-muted">{strings.tradeSlLabel}</span>
          <input
            className={`${inputClass} num mt-1`}
            inputMode="decimal"
            value={sl}
            disabled={sent}
            onChange={(e) => setSl(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="text-muted">{strings.tradeTpLabel}</span>
          <input
            className={`${inputClass} num mt-1`}
            inputMode="decimal"
            value={tp}
            disabled={sent}
            onChange={(e) => setTp(e.target.value)}
          />
        </label>
        <span className="col-span-2 -mt-1 text-xs text-muted">
          {pending ? strings.orderPendingHint : strings.orderMarketHint} {strings.tradeStopsHint}
        </span>
      </div>

      {invalid && (
        <p role="alert" className="mb-2 text-sm text-loss">
          {invalid}
        </p>
      )}
      {send.isPending && (
        <p role="status" className="text-sm text-muted">
          {strings.tradeSending}
        </p>
      )}
      {send.isError && (
        <p role="alert" className="text-sm text-loss">
          {errorText(send.error)}
        </p>
      )}
      {cmdId !== null && <TradeOutcome cmdId={cmdId} />}
    </Dialog>
  )
}

function CloseAllDialog({
  linkId,
  positions,
  onClose,
}: {
  linkId: number
  positions: Position[]
  onClose: () => void
}) {
  const send = useSendTrade(linkId)
  const [filter, setFilter] = useState<Filter>('all')
  const cmdId = send.data?.cmd_id ?? null
  const sent = send.isPending || cmdId !== null
  const matched = positions.filter((p) => matchesCloseAll(filter, p)).length

  return (
    <Dialog
      title={strings.closeAllDlgTitle}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{sent ? strings.tradeCloseDlg : strings.tradeCancel}</Button>
          {!sent && (
            <Button
              variant="danger"
              disabled={matched === 0}
              onClick={() => send.mutate({ op: 'close_all', filter })}
            >
              {strings.tradeConfirmSend}
            </Button>
          )}
        </>
      }
    >
      <fieldset className="mb-3 text-sm" disabled={sent}>
        <legend className="mb-1 text-muted">{strings.closeAllFilterLabel}</legend>
        <div className="space-y-1.5">
          {CLOSE_ALL_FILTERS.map((f) => (
            <label key={f} className="flex items-center gap-2">
              <input
                type="radio"
                name="close-all-filter"
                checked={filter === f}
                onChange={() => setFilter(f)}
              />
              {FILTER_LABEL[f]}
            </label>
          ))}
        </div>
      </fieldset>

      <p
        className={`num mb-2 rounded-md bg-raised px-3 py-2 text-sm font-medium ${matched === 0 ? 'text-muted' : ''}`}
      >
        {matched === 0 ? strings.closeAllNone : strings.closeAllMatched(matched)}
      </p>
      <p className="mb-3 text-xs text-muted">{strings.closeAllWarn}</p>

      {send.isPending && (
        <p role="status" className="text-sm text-muted">
          {strings.tradeSending}
        </p>
      )}
      {send.isError && (
        <p role="alert" className="text-sm text-loss">
          {errorText(send.error)}
        </p>
      )}
      {cmdId !== null && <TradeOutcome cmdId={cmdId} />}
    </Dialog>
  )
}

/** Thanh nút ở đầu thẻ "Lệnh đang mở": Đặt lệnh và Đóng tất cả. `disabled` khi terminal chưa Live. */
export function PositionsToolbar({
  linkId,
  positions,
  disabled,
}: {
  linkId: number
  positions: Position[]
  disabled: boolean
}) {
  const [dlg, setDlg] = useState<'order' | 'closeAll' | null>(null)
  const hint = disabled ? strings.tradeNeedLive : undefined
  return (
    <div className="flex gap-1.5">
      <Button size="sm" variant="primary" disabled={disabled} title={hint} onClick={() => setDlg('order')}>
        {strings.orderBtnOpen}
      </Button>
      <Button
        size="sm"
        variant="danger"
        disabled={disabled}
        title={hint}
        onClick={() => setDlg('closeAll')}
      >
        {strings.closeAllBtn}
      </Button>
      {dlg === 'order' && (
        <OrderDialog
          linkId={linkId}
          defaultSymbol={positions[0]?.symbol ?? ''}
          onClose={() => setDlg(null)}
        />
      )}
      {dlg === 'closeAll' && (
        <CloseAllDialog linkId={linkId} positions={positions} onClose={() => setDlg(null)} />
      )}
    </div>
  )
}
