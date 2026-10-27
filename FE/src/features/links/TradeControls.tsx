import { type Position, TRADE, type TradeReason, type TradeRequest } from '@az-sentinel/shared'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { Button } from '../../components/Button'
import { Dialog } from '../../components/Dialog'
import { inputClass } from '../../components/styles'
import { ApiError } from '../../lib/api-client'
import { strings } from '../../lib/strings'
import { useSendTrade, useSetTradeEnabled } from './api'
import { getTradeResult, subscribeTrade } from './live/live-store'

/**
 * Giao dịch thủ công từ xa (v0.2.6): đóng lệnh, đóng một phần, sửa SL/TP.
 * Mọi lệnh đều qua hộp thoại xác nhận nêu rõ ticket, symbol, khối lượng. Kết quả hiện là retcode thật của MT5
 * (đến qua WebSocket), không báo thành công giả: 202 từ server chỉ nghĩa là lệnh đã được chuyển đi.
 */

type Mode = 'close' | 'partial' | 'modify'

const toNum = (s: string): number => Number(s.trim().replace(',', '.'))

/** Ô SL/TP: trống = 0 (bỏ). Trả NaN nếu không hợp lệ. */
function parseStop(s: string): number {
  if (s.trim() === '') return 0
  const n = toNum(s)
  return Number.isFinite(n) && n >= 0 ? n : Number.NaN
}

function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'TRADE_DISABLED') return strings.tradeErrDisabled
    if (e.code === 'TRADE_BUSY') return strings.tradeErrBusy
    if (e.status === 403) return strings.tradeErrForbidden
  }
  return strings.tradeErrGeneric
}

/**
 * Hạn chờ phía FE: hạn dùng của lệnh + ân hạn của Gateway + 5 giây dự phòng. Quá hạn mà vẫn chưa có kết quả
 * (Gateway ở VPS khác còn bản cũ không hiểu lệnh, mất kết nối...) thì báo "không biết" thay vì chờ mãi.
 * Kết quả thật đến muộn vẫn hiện và thắng.
 */
export const TRADE_CLIENT_WAIT_MS = TRADE.ttlMs + TRADE.graceMs + 5_000

export function TradeOutcome({ cmdId }: { cmdId: string }) {
  const result = useSyncExternalStore(
    subscribeTrade,
    () => getTradeResult(cmdId),
    () => undefined,
  )
  const [stale, setStale] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => setStale(true), TRADE_CLIENT_WAIT_MS)
    return () => clearTimeout(id)
  }, [])
  if (!result && stale) {
    return (
      <p role="alert" className="rounded-md bg-loss-bg px-3 py-2 text-sm text-loss">
        {strings.tradeTimeout}
      </p>
    )
  }
  if (!result) {
    return (
      <p role="status" className="rounded-md bg-live-bg px-3 py-2 text-sm text-live">
        {strings.tradeWaiting}
      </p>
    )
  }
  if (result.status === 'timeout') {
    return (
      <p role="alert" className="rounded-md bg-loss-bg px-3 py-2 text-sm text-loss">
        {strings.tradeTimeout}
      </p>
    )
  }
  const reason = strings.tradeReasons[result.reason as TradeReason] ?? result.reason
  if (result.status === 'done') {
    return (
      <p role="status" className="rounded-md bg-live-bg px-3 py-2 text-sm text-live">
        {strings.tradeDone}
        {result.left !== undefined && result.left > 0
          ? ` · ${strings.tradeDoneLeft}: ${result.left}`
          : ''}
        {result.code > 0 ? ` · ${strings.tradeRetcode} ${result.code}` : ''}
      </p>
    )
  }
  return (
    <div role="alert" className="rounded-md bg-loss-bg px-3 py-2 text-sm text-loss">
      <p className="font-medium">
        {strings.tradeFailed}: {reason}
      </p>
      {(result.detail !== '' || result.code > 0) && (
        <p className="mt-0.5 text-xs">
          {result.code > 0 ? `${strings.tradeRetcode} ${result.code}` : ''}
          {result.code > 0 && result.detail !== '' ? ' · ' : ''}
          {result.detail}
        </p>
      )}
    </div>
  )
}

function TradeDialog({
  linkId,
  position: p,
  mode,
  onClose,
}: {
  linkId: number
  position: Position
  mode: Mode
  onClose: () => void
}) {
  const send = useSendTrade(linkId)
  const [volume, setVolume] = useState('')
  const [sl, setSl] = useState(p.sl ? String(p.sl) : '')
  const [tp, setTp] = useState(p.tp ? String(p.tp) : '')
  const [invalid, setInvalid] = useState<string | null>(null)
  const cmdId = send.data?.cmd_id ?? null
  const sent = send.isPending || cmdId !== null

  const title =
    mode === 'close'
      ? strings.tradeDlgClose
      : mode === 'partial'
        ? strings.tradeDlgPartial
        : strings.tradeDlgModify

  function submit() {
    let req: TradeRequest
    if (mode === 'close') {
      req = { op: 'close', ticket: p.ticket }
    } else if (mode === 'partial') {
      const v = toNum(volume)
      if (volume.trim() === '' || !Number.isFinite(v) || v <= 0 || v >= p.volume) {
        setInvalid(strings.tradeInvalidVolume)
        return
      }
      req = { op: 'partial_close', ticket: p.ticket, volume: v }
    } else {
      const s = parseStop(sl)
      const t = parseStop(tp)
      if (Number.isNaN(s) || Number.isNaN(t)) {
        setInvalid(strings.tradeInvalidStops)
        return
      }
      req = { op: 'modify', ticket: p.ticket, sl: s, tp: t }
    }
    setInvalid(null)
    send.mutate(req)
  }

  return (
    <Dialog
      title={`${title} #${p.ticket}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{sent ? strings.tradeCloseDlg : strings.tradeCancel}</Button>
          {!sent && (
            <Button variant={mode === 'modify' ? 'primary' : 'danger'} onClick={submit}>
              {strings.tradeConfirmSend}
            </Button>
          )}
        </>
      }
    >
      <p className="num mb-3 rounded-md bg-raised px-3 py-2 text-sm">
        #{p.ticket} · <span className="font-medium">{p.symbol}</span> · {p.type} · {p.volume} lot @{' '}
        {p.price}
      </p>

      {mode === 'partial' && (
        <label className="mb-3 block text-sm">
          <span className="text-muted">{strings.tradeVolumeLabel}</span>
          <input
            className={`${inputClass} num mt-1`}
            inputMode="decimal"
            value={volume}
            disabled={sent}
            onChange={(e) => setVolume(e.target.value)}
            placeholder={`< ${p.volume}`}
          />
          <span className="mt-1 block text-xs text-muted">{strings.tradeVolumeHint}</span>
        </label>
      )}

      {mode === 'modify' && (
        <div className="mb-3 grid grid-cols-2 gap-3 text-sm">
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
          <span className="col-span-2 -mt-1 text-xs text-muted">{strings.tradeStopsHint}</span>
        </div>
      )}

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

/** Các nút thao tác của một dòng lệnh. `disabled` khi terminal chưa Live. */
export function PositionTradeActions({
  linkId,
  position,
  disabled,
}: {
  linkId: number
  position: Position
  disabled: boolean
}) {
  const [mode, setMode] = useState<Mode | null>(null)
  const hint = disabled ? strings.tradeNeedLive : undefined
  return (
    <div className="flex justify-end gap-1.5">
      <Button
        size="sm"
        variant="danger"
        disabled={disabled}
        title={hint}
        onClick={() => setMode('close')}
      >
        {strings.tradeBtnClose}
      </Button>
      <Button size="sm" disabled={disabled} title={hint} onClick={() => setMode('partial')}>
        {strings.tradeBtnPartial}
      </Button>
      <Button size="sm" disabled={disabled} title={hint} onClick={() => setMode('modify')}>
        {strings.tradeBtnModify}
      </Button>
      {mode !== null && (
        <TradeDialog
          linkId={linkId}
          position={position}
          mode={mode}
          onClose={() => setMode(null)}
        />
      )}
    </div>
  )
}

/** Công tắc bật/tắt giao dịch từ xa của liên kết (chỉ admin thấy). Mặc định tắt. */
export function TradeEnableToggle({ linkId, enabled }: { linkId: number; enabled: boolean }) {
  const set = useSetTradeEnabled(linkId)
  function toggle() {
    if (!enabled && !window.confirm(strings.tradeRemoteConfirmEnable)) return
    set.mutate(!enabled)
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={enabled ? 'text-sm font-medium text-loss' : 'text-sm text-muted'}>
        {enabled ? strings.tradeRemoteOn : strings.tradeRemoteOff}
      </span>
      <Button
        size="sm"
        variant={enabled ? 'secondary' : 'danger'}
        disabled={set.isPending}
        onClick={toggle}
      >
        {enabled ? strings.tradeRemoteDisable : strings.tradeRemoteEnable}
      </Button>
      {set.isError && (
        <span role="alert" className="text-xs text-loss">
          {strings.actionFailed}
        </span>
      )}
    </div>
  )
}
