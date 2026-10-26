import { IP_RULE_DEFAULT_MAX_CONNS, type IpRule, shortDeviceId } from '@az-sentinel/shared'
import { type FormEvent, useState } from 'react'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { inputClass } from '../../components/styles'
import { ApiError } from '../../lib/api-client'
import { formatRelative } from '../../lib/format'
import { strings } from '../../lib/strings'
import { useAddIp, useIpState, useRemoveIp, useSetGuard, useUpdateIp } from './api'

function AddForm({ initialIp = '' }: { initialIp?: string }) {
  const add = useAddIp()
  const [ip, setIp] = useState(initialIp)
  const [label, setLabel] = useState('')
  const [max, setMax] = useState(String(IP_RULE_DEFAULT_MAX_CONNS))
  const [error, setError] = useState<string | null>(null)

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    add.mutate(
      { ip: ip.trim(), label: label.trim(), max_conns: Number(max) },
      {
        onSuccess: () => {
          setIp('')
          setLabel('')
          setMax(String(IP_RULE_DEFAULT_MAX_CONNS))
        },
        onError: (err) =>
          setError(
            err instanceof ApiError && err.status === 409
              ? strings.ipAddDuplicate
              : err instanceof ApiError && err.status === 400
                ? strings.ipAddInvalid
                : strings.ipAddFailed,
          ),
      },
    )
  }

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
      <div className="min-w-56 flex-1">
        <label className="block text-sm font-medium" htmlFor="ip-new">
          {strings.ipFieldIp}
        </label>
        <input
          id="ip-new"
          value={ip}
          onChange={(e) => setIp(e.target.value)}
          className={`${inputClass} mt-1`}
        />
      </div>
      <div className="min-w-40 flex-1">
        <label className="block text-sm font-medium" htmlFor="ip-label">
          {strings.ipFieldLabel}
        </label>
        <input
          id="ip-label"
          value={label}
          maxLength={64}
          onChange={(e) => setLabel(e.target.value)}
          className={`${inputClass} mt-1`}
        />
      </div>
      <div className="w-32">
        <label className="block text-sm font-medium" htmlFor="ip-max">
          {strings.ipFieldMax}
        </label>
        <input
          id="ip-max"
          type="number"
          min={1}
          max={100}
          value={max}
          onChange={(e) => setMax(e.target.value)}
          className={`${inputClass} mt-1`}
        />
      </div>
      <Button type="submit" variant="primary" disabled={add.isPending || ip.trim() === ''}>
        {strings.ipAdd}
      </Button>
      {error && (
        <p role="alert" className="basis-full text-sm text-loss">
          {error}
        </p>
      )}
    </form>
  )
}

function Row({ rule }: { rule: IpRule }) {
  const update = useUpdateIp()
  const remove = useRemoveIp()
  const [label, setLabel] = useState(rule.label)
  const [max, setMax] = useState(String(rule.max_conns))
  const dirty = label !== rule.label || Number(max) !== rule.max_conns
  const busy = update.isPending || remove.isPending
  const failed = update.isError || remove.isError
  const lockout = remove.error instanceof ApiError && remove.error.status === 409

  return (
    <tr className="border-t border-line align-middle">
      <td className="px-3 py-2 font-mono text-[0.8125rem]">{rule.ip}</td>
      <td className="px-3 py-2">
        <input
          aria-label={strings.ipColLabel}
          value={label}
          maxLength={64}
          onChange={(e) => setLabel(e.target.value)}
          className={inputClass}
        />
      </td>
      <td className="px-3 py-2">
        <input
          aria-label={strings.ipColMax}
          type="number"
          min={1}
          max={100}
          value={max}
          onChange={(e) => setMax(e.target.value)}
          className={`${inputClass} w-24`}
        />
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={busy || !dirty}
            onClick={() => update.mutate({ id: rule.id, body: { label, max_conns: Number(max) } })}
          >
            {strings.ipSave}
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={busy}
            onClick={() => {
              if (window.confirm(strings.ipConfirmRemove)) remove.mutate(rule.id)
            }}
          >
            {strings.ipRemove}
          </Button>
          {failed && (
            <span role="alert" className="text-xs text-loss">
              {lockout ? strings.ipRemoveLastOfYours : strings.ipActionFailed}
            </span>
          )}
        </div>
      </td>
    </tr>
  )
}

/** Trang Whitelist IP (chỉ quản trị viên): bật/tắt bảo vệ, thêm/sửa/bỏ IP, cho phép IP vừa bị chặn. */
export function IpPanel() {
  const state = useIpState()
  const guard = useSetGuard()
  const add = useAddIp()
  const forbidden = state.error instanceof ApiError && state.error.status === 403
  const data = state.data

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{strings.ipTitle}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">{strings.ipHint}</p>
      </div>

      {forbidden ? (
        <p role="alert" className="rounded-md bg-notice-bg px-3 py-2 text-sm text-notice-ink">
          {strings.ipForbidden}
        </p>
      ) : (
        <>
          {state.isPending && <p className="text-sm text-muted">{strings.ipLoading}</p>}
          {state.isError && (
            <p role="alert" className="text-sm text-loss">
              {strings.ipError}{' '}
              <Button size="sm" onClick={() => state.refetch()}>
                {strings.retry}
              </Button>
            </p>
          )}
          {data && (
            <>
              <Card title={strings.ipGuardTitle}>
                <div className="space-y-3">
                  <p className="text-sm font-medium">
                    {data.enforce ? strings.ipGuardOn : strings.ipGuardOff}
                  </p>
                  <p className="text-sm text-muted">
                    {strings.ipYourIp}:{' '}
                    <span className="font-mono">{data.your_ip ?? strings.ipYourIpUnknown}</span>
                    {data.your_ip &&
                      ` — ${data.your_ip_allowed ? strings.ipYourIpAllowed : strings.ipYourIpNotAllowed}`}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    {data.your_ip && !data.your_ip_allowed && (
                      <Button
                        size="sm"
                        disabled={add.isPending}
                        onClick={() =>
                          data.your_ip && add.mutate({ ip: data.your_ip, label: 'Admin' })
                        }
                      >
                        {strings.ipAddYours}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant={data.enforce ? 'danger' : 'primary'}
                      disabled={guard.isPending || (!data.enforce && !data.your_ip_allowed)}
                      onClick={() => guard.mutate(!data.enforce)}
                    >
                      {data.enforce ? strings.ipGuardDisable : strings.ipGuardEnable}
                    </Button>
                  </div>
                  {!data.enforce && !data.your_ip_allowed && (
                    <p className="text-xs text-muted">{strings.ipGuardNeedYours}</p>
                  )}
                  {guard.isError && (
                    <p role="alert" className="text-sm text-loss">
                      {strings.ipGuardFailed}
                    </p>
                  )}
                </div>
              </Card>

              <Card title={strings.ipAddTitle}>
                <AddForm />
              </Card>

              <Card title={strings.ipListTitle}>
                {data.rules.length === 0 ? (
                  <p className="text-sm text-muted">{strings.ipEmpty}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="text-xs text-muted">
                        <tr>
                          <th className="px-3 py-1.5 font-medium">{strings.ipColIp}</th>
                          <th className="px-3 py-1.5 font-medium">{strings.ipColLabel}</th>
                          <th className="px-3 py-1.5 font-medium">{strings.ipColMax}</th>
                          <th className="px-3 py-1.5 font-medium">{strings.ipColActions}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.rules.map((r) => (
                          <Row key={`${r.id}:${r.label}:${r.max_conns}`} rule={r} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              <Card title={strings.ipBlockedTitle}>
                <p className="mb-2 text-sm text-muted">{strings.ipBlockedHint}</p>
                {data.blocked.length === 0 ? (
                  <p className="text-sm text-muted">{strings.ipBlockedEmpty}</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {data.blocked.map((b) => (
                      <li
                        key={b.ip}
                        className="flex flex-wrap items-center justify-between gap-2 py-2"
                      >
                        <span>
                          <span className="font-mono text-[0.8125rem]">{b.ip}</span>
                          <span className="ml-2 text-xs text-muted">
                            {formatRelative(b.last_at)} · {b.count} {strings.ipBlockedTimes}
                            {b.device_id &&
                              ` · ${strings.ipBlockedDevice} ${b.device_label || shortDeviceId(b.device_id)}`}
                          </span>
                        </span>
                        <Button
                          size="sm"
                          disabled={add.isPending}
                          onClick={() => add.mutate({ ip: b.ip })}
                        >
                          {strings.ipBlockedAllow}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </>
          )}
        </>
      )}
    </div>
  )
}
