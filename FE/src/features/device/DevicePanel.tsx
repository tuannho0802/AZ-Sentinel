import { type DeviceMode, type DeviceRule, shortDeviceId } from '@az-sentinel/shared'
import { useState } from 'react'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { inputClass } from '../../components/styles'
import { ApiError } from '../../lib/api-client'
import { formatRelative } from '../../lib/format'
import { strings } from '../../lib/strings'
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

/** Đoán ngắn gọn trình duyệt + hệ điều hành từ User-Agent để admin nhận ra thiết bị. */
function describeUa(ua: string): string {
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : ''
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad|iOS/.test(ua)
        ? 'iOS'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : ''
  return [browser, os].filter(Boolean).join(' · ') || ua.slice(0, 40)
}

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

function Row({ rule }: { rule: DeviceRule }) {
  const update = useUpdateDevice()
  const remove = useRemoveDevice()
  const [label, setLabel] = useState(rule.label)
  const [mode, setMode] = useState<DeviceMode>(rule.mode)
  const dirty = label !== rule.label || mode !== rule.mode
  const busy = update.isPending || remove.isPending
  const failed = update.isError || remove.isError
  const lockout = remove.error instanceof ApiError && remove.error.status === 409

  return (
    <tr className="border-t border-line align-middle">
      <td className="px-3 py-2">
        <div className="font-mono text-[0.8125rem]">{shortDeviceId(rule.device_id)}</div>
        <div className="text-xs text-muted">
          {rule.kind === 'gateway' ? strings.devKindGateway : strings.devKindWeb}
        </div>
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
      <td className="px-3 py-2 text-xs text-muted">
        {rule.last_seen ? (
          <>
            <span className="font-mono">{rule.last_ip}</span> · {formatRelative(rule.last_seen)}
          </>
        ) : (
          strings.devNeverSeen
        )}
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={busy || !dirty}
            onClick={() => update.mutate({ id: rule.id, body: { label, mode } })}
          >
            {strings.ipSave}
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={busy}
            onClick={() => {
              if (window.confirm(strings.devConfirmRemove)) remove.mutate(rule.id)
            }}
          >
            {strings.ipRemove}
          </Button>
          {failed && (
            <span role="alert" className="text-xs text-loss">
              {lockout ? strings.devRemoveYours : strings.ipActionFailed}
            </span>
          )}
        </div>
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
                <span className="font-mono">
                  {data.your_device_id
                    ? shortDeviceId(data.your_device_id)
                    : strings.devYoursUnknown}
                </span>
                {data.your_device_id &&
                  ` — ${data.your_device_allowed ? strings.devYoursAllowed : strings.devYoursNotAllowed}`}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {data.your_device_id && !data.your_device_allowed && (
                  <>
                    <Button
                      size="sm"
                      disabled={add.isPending}
                      onClick={() =>
                        data.your_device_id &&
                        add.mutate({
                          device_id: data.your_device_id,
                          label: strings.devYoursLabel,
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
                          label: strings.devYoursLabel,
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
            ) : (
              <ul className="divide-y divide-line">
                {data.pending.map((p) => (
                  <li
                    key={p.device_id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2"
                  >
                    <span>
                      <span className="font-mono text-[0.8125rem]">
                        {shortDeviceId(p.device_id)}
                      </span>
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
            )}
          </Card>

          <Card title={strings.devListTitle}>
            {data.rules.length === 0 ? (
              <p className="text-sm text-muted">{strings.devEmpty}</p>
            ) : (
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
