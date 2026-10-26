import { type DeviceMode, type DeviceRule, shortDeviceId } from '@az-sentinel/shared'
import { useState } from 'react'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { DeviceTag } from '../../components/DeviceTag'
import { Field, MobileCard, MobileCardList } from '../../components/MobileCard'
import { inputClass } from '../../components/styles'
import { ApiError } from '../../lib/api-client'
import { describeUa, useOwnDevice, withOwner } from '../../lib/device-name'
import { formatRelative } from '../../lib/format'
import { strings } from '../../lib/strings'
import { useIsWide } from '../../lib/use-media'
import { useMe } from '../auth/api'
import {
  useAddDevice,
  useDeviceState,
  useDismissPending,
  useRemoveDevice,
  useSetDeviceGuard,
  useUpdateDevice,
} from './api'

const modeText = (mode: DeviceMode) =>
  mode === 'any_ip' ? strings.devModeAnyIp : strings.devModeDeviceOnly

function ModeSelect({
  value,
  onChange,
  label,
}: {
  value: DeviceMode
  onChange: (m: DeviceMode) => void
  label: string
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as DeviceMode)}
      className={inputClass}
    >
      <option value="any_ip">{strings.devModeAnyIp}</option>
      <option value="device_only">{strings.devModeDeviceOnly}</option>
    </select>
  )
}

function Row({ rule, card = false }: { rule: DeviceRule; card?: boolean }) {
  const update = useUpdateDevice()
  const remove = useRemoveDevice()
  const [label, setLabel] = useState(rule.label)
  const [mode, setMode] = useState<DeviceMode>(rule.mode)
  const dirty = label !== rule.label || mode !== rule.mode
  const busy = update.isPending || remove.isPending
  const failed = update.isError || remove.isError
  const lockout = remove.error instanceof ApiError && remove.error.status === 409

  const sz = card ? 'md' : 'sm'
  const kind = rule.kind === 'gateway' ? strings.devKindGateway : strings.devKindWeb
  const seen = rule.last_seen ? (
    <>
      <span className="font-mono">{rule.last_ip}</span> · {formatRelative(rule.last_seen)}
    </>
  ) : (
    strings.devNeverSeen
  )
  const actions = (
    <>
      <Button
        size={sz}
        className={card ? 'flex-1' : ''}
        disabled={busy || !dirty}
        onClick={() => update.mutate({ id: rule.id, body: { label, mode } })}
      >
        {strings.ipSave}
      </Button>
      <Button
        size={sz}
        variant="danger"
        className={card ? 'flex-1' : ''}
        disabled={busy}
        onClick={() => {
          if (window.confirm(strings.devConfirmRemove)) remove.mutate(rule.id)
        }}
      >
        {strings.ipRemove}
      </Button>
      {failed && (
        <span role="alert" className="basis-full text-xs text-loss">
          {lockout ? strings.devRemoveYours : strings.ipActionFailed}
        </span>
      )}
    </>
  )

  if (card) {
    return (
      <MobileCard
        stripe="border-l-gain"
        head={
          <>
            <div className="min-w-0">
              <div className="truncate font-semibold">{label || kind}</div>
              <div className="text-xs text-muted">
                <DeviceTag id={shortDeviceId(rule.device_id)} />{' '}
                <span className="ml-1">{kind}</span>
              </div>
            </div>
            <span className="shrink-0 text-right text-xs text-muted">{seen}</span>
          </>
        }
        actions={actions}
      >
        <dl className="grid grid-cols-1 gap-3">
          <Field label={strings.devColLabel}>
            <input
              aria-label={strings.devColLabel}
              value={label}
              maxLength={64}
              onChange={(e) => setLabel(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label={strings.devColMode}>
            <ModeSelect value={mode} onChange={setMode} label={strings.devColMode} />
          </Field>
        </dl>
      </MobileCard>
    )
  }

  return (
    <tr className="border-t border-line align-middle">
      <td className="px-3 py-2">
        <DeviceTag id={shortDeviceId(rule.device_id)} />
        <div className="mt-1 text-xs text-muted">{kind}</div>
      </td>
      <td className="px-3 py-2">
        <input
          aria-label={strings.devColLabel}
          value={label}
          maxLength={64}
          onChange={(e) => setLabel(e.target.value)}
          className={inputClass}
        />
      </td>
      <td className="px-3 py-2">
        <ModeSelect value={mode} onChange={setMode} label={strings.devColMode} />
      </td>
      <td className="px-3 py-2 text-xs text-muted">{seen}</td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </td>
    </tr>
  )
}

/**
 * Whitelist thiết bị (chỉ quản trị viên), nằm dưới whitelist IP: bật/tắt "chỉ thiết bị đã duyệt", duyệt thiết bị của
 * mình, duyệt thiết bị lạ vừa bị chặn theo một trong hai chế độ (mọi IP / chỉ thiết bị), sửa và gỡ thiết bị.
 */
export function DevicePanel() {
  const state = useDeviceState()
  const guard = useSetDeviceGuard()
  const add = useAddDevice()
  const dismiss = useDismissPending()
  const forbidden = state.error instanceof ApiError && state.error.status === 403
  const data = state.data
  const wide = useIsWide()
  const me = useMe()
  // Nhãn gợi ý cho máy đang dùng, ví dụ "Galaxy S23 Ultra · Chrome · Android 14 của Tuấn".
  const ownLabel = withOwner(useOwnDevice(), me.data?.display_name)

  if (forbidden) return null

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">{strings.devTitle}</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted">{strings.devHint}</p>
      </div>
      {state.isPending && <p className="text-sm text-muted">{strings.ipLoading}</p>}
      {state.isError && (
        <p role="alert" className="text-sm text-loss">
          {strings.devError}{' '}
          <Button size="sm" onClick={() => state.refetch()}>
            {strings.retry}
          </Button>
        </p>
      )}
      {data && (
        <>
          <Card title={strings.devGuardTitle}>
            <div className="space-y-3">
              <p className="text-sm font-medium">
                {data.enforce ? strings.devGuardOn : strings.devGuardOff}
              </p>
              <p className="text-sm text-muted">
                {strings.devYours}:{' '}
                {data.your_device_id ? (
                  <DeviceTag id={shortDeviceId(data.your_device_id)} />
                ) : (
                  <span className="font-mono">{strings.devYoursUnknown}</span>
                )}
                {data.your_device_id &&
                  ` — ${data.your_device_allowed ? strings.devYoursAllowed : strings.devYoursNotAllowed}`}
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                {data.your_device_id && !data.your_device_allowed && (
                  <>
                    <Button
                      size="sm"
                      disabled={add.isPending}
                      onClick={() =>
                        data.your_device_id &&
                        add.mutate({
                          device_id: data.your_device_id,
                          label: ownLabel,
                          mode: 'any_ip',
                        })
                      }
                    >
                      {strings.devAddYoursAnyIp}
                    </Button>
                    <Button
                      size="sm"
                      disabled={add.isPending}
                      onClick={() =>
                        data.your_device_id &&
                        add.mutate({
                          device_id: data.your_device_id,
                          label: ownLabel,
                          mode: 'device_only',
                        })
                      }
                    >
                      {strings.devAddYoursDeviceOnly}
                    </Button>
                  </>
                )}
                <Button
                  size="sm"
                  variant={data.enforce ? 'danger' : 'primary'}
                  disabled={guard.isPending || (!data.enforce && !data.your_device_allowed)}
                  onClick={() => guard.mutate(!data.enforce)}
                >
                  {data.enforce ? strings.devGuardDisable : strings.devGuardEnable}
                </Button>
              </div>
              {!data.enforce && !data.your_device_allowed && (
                <p className="text-xs text-muted">{strings.devGuardNeedYours}</p>
              )}
              {(guard.isError || add.isError) && (
                <p role="alert" className="text-sm text-loss">
                  {guard.isError ? strings.devGuardFailed : strings.devAddFailed}
                </p>
              )}
            </div>
          </Card>

          <Card title={strings.devPendingTitle}>
            <p className="mb-2 text-sm text-muted">{strings.devPendingHint}</p>
            {data.pending.length === 0 ? (
              <p className="text-sm text-muted">{strings.devPendingEmpty}</p>
            ) : wide ? (
              <ul className="divide-y divide-line">
                {data.pending.map((p) => (
                  <li
                    key={p.device_id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2"
                  >
                    <span>
                      <DeviceTag id={shortDeviceId(p.device_id)} />
                      <span className="ml-2 text-xs text-muted">
                        {p.kind === 'gateway' ? strings.devKindGateway : describeUa(p.user_agent)}
                        {' · '}
                        <span className="font-mono">{p.ip}</span> · {formatRelative(p.last_at)} ·{' '}
                        {p.count} {strings.ipBlockedTimes}
                      </span>
                    </span>
                    <span className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        disabled={add.isPending}
                        onClick={() =>
                          add.mutate({
                            device_id: p.device_id,
                            mode: 'any_ip',
                            label:
                              p.kind === 'gateway'
                                ? strings.devKindGateway
                                : describeUa(p.user_agent),
                          })
                        }
                      >
                        {strings.devApproveAnyIp}
                      </Button>
                      <Button
                        size="sm"
                        disabled={add.isPending}
                        onClick={() =>
                          add.mutate({
                            device_id: p.device_id,
                            mode: 'device_only',
                            label:
                              p.kind === 'gateway'
                                ? strings.devKindGateway
                                : describeUa(p.user_agent),
                          })
                        }
                      >
                        {strings.devApproveDeviceOnly}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={dismiss.isPending}
                        onClick={() => dismiss.mutate(p.device_id)}
                      >
                        {strings.devDismiss}
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <MobileCardList label={strings.devPendingTitle}>
                {data.pending.map((p) => {
                  const name =
                    p.kind === 'gateway' ? strings.devKindGateway : describeUa(p.user_agent)
                  return (
                    <MobileCard
                      key={p.device_id}
                      stripe="border-l-notice-ink"
                      head={
                        <>
                          <div className="min-w-0">
                            <div className="truncate font-semibold">{name}</div>
                            <div className="mt-1">
                              <DeviceTag id={shortDeviceId(p.device_id)} />
                            </div>
                          </div>
                          <span className="shrink-0 text-right text-xs text-muted">
                            {formatRelative(p.last_at)}
                          </span>
                        </>
                      }
                      actions={
                        <div className="grid w-full grid-cols-2 gap-2">
                          <Button
                            className="h-10"
                            disabled={add.isPending}
                            onClick={() =>
                              add.mutate({ device_id: p.device_id, mode: 'any_ip', label: name })
                            }
                          >
                            {strings.devApproveAnyIp}
                          </Button>
                          <Button
                            className="h-10"
                            disabled={add.isPending}
                            onClick={() =>
                              add.mutate({
                                device_id: p.device_id,
                                mode: 'device_only',
                                label: name,
                              })
                            }
                          >
                            {strings.devApproveDeviceOnly}
                          </Button>
                          <Button
                            variant="danger"
                            className="col-span-2 h-10"
                            disabled={dismiss.isPending}
                            onClick={() => dismiss.mutate(p.device_id)}
                          >
                            {strings.devDismiss}
                          </Button>
                        </div>
                      }
                    >
                      <p className="text-sm text-muted">
                        <span className="font-mono">{p.ip}</span> · {p.count}{' '}
                        {strings.ipBlockedTimes}
                      </p>
                    </MobileCard>
                  )
                })}
              </MobileCardList>
            )}
          </Card>

          <Card title={strings.devListTitle}>
            {data.rules.length === 0 ? (
              <p className="text-sm text-muted">{strings.devEmpty}</p>
            ) : wide ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-muted">
                    <tr>
                      <th className="px-3 py-1.5 font-medium">{strings.devColDevice}</th>
                      <th className="px-3 py-1.5 font-medium">{strings.devColLabel}</th>
                      <th className="px-3 py-1.5 font-medium">{strings.devColMode}</th>
                      <th className="px-3 py-1.5 font-medium">{strings.devColSeen}</th>
                      <th className="px-3 py-1.5 font-medium">{strings.ipColActions}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rules.map((r) => (
                      <Row key={`${r.id}:${r.label}:${r.mode}`} rule={r} />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <MobileCardList label={strings.devListTitle}>
                {data.rules.map((r) => (
                  <Row key={`${r.id}:${r.label}:${r.mode}`} card rule={r} />
                ))}
              </MobileCardList>
            )}
            <p className="mt-2 text-xs text-muted">
              {modeText('any_ip')}: {strings.devModeAnyIpHint} {modeText('device_only')}:{' '}
              {strings.devModeDeviceOnlyHint}
            </p>
          </Card>
        </>
      )}
    </div>
  )
}
