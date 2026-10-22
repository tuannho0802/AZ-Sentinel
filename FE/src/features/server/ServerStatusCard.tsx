import type { ServerInfo, ServerNode } from '@az-sentinel/shared'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { formatDateTime, formatRelative } from '../../lib/format'
import { strings } from '../../lib/strings'
import { useServerInfo } from './api'

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d > 0) return `${d} ngày ${h} giờ`
  if (h > 0) return `${h} giờ ${m} phút`
  return `${m} phút`
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 py-1">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium">{value}</dd>
    </div>
  )
}

function NodeRows({ node }: { node: ServerNode }) {
  const rows: [string, string | null][] = [
    [strings.serverFieldHost, node.host],
    [strings.serverFieldOs, node.os ? `${node.os}${node.arch ? ` (${node.arch})` : ''}` : null],
    [strings.serverFieldRuntime, node.runtime],
    [strings.serverFieldVersion, node.version],
    [strings.serverFieldUptime, formatUptime(node.uptimeSec)],
    [
      strings.serverFieldCpu,
      node.cpuPct === null ? null : `${node.cpuPct}% / ${node.cpuCount ?? '?'} lõi`,
    ],
    [
      strings.serverFieldMem,
      node.memFreeMb === null || node.memTotalMb === null
        ? null
        : `${node.memFreeMb} / ${node.memTotalMb} ${strings.serverUnitMb}`,
    ],
    [strings.serverFieldLocation, node.location],
  ]
  return (
    <>
      {rows.map(([label, value]) =>
        value === null ? null : <Row key={label} label={label} value={value} />,
      )}
    </>
  )
}

export function ServerStatusCard() {
  const q = useServerInfo()
  return (
    <Card title={strings.serverCardTitle}>
      {q.isPending && <p className="text-muted">{strings.serverLoading}</p>}
      {q.isError && (
        <div role="alert">
          <p className="text-loss">{strings.serverError}</p>
          <Button className="mt-3" onClick={() => q.refetch()}>
            {strings.retry}
          </Button>
        </div>
      )}
      {q.data && <Details info={q.data} />}
    </Card>
  )
}

function Details({ info }: { info: ServerInfo }) {
  const modeText =
    info.mode === 'primary'
      ? strings.serverModePrimary
      : info.mode === 'fallback'
        ? strings.serverModeFallback
        : strings.serverModeStandalone
  const standby = info.standby
  return (
    <div className="text-sm">
      <p className="font-medium">{modeText}</p>
      <dl className="mt-2 divide-y divide-line">
        <Row label={strings.serverFieldActive} value={info.active.name} />
        <NodeRows node={info.active} />
        <Row label={strings.serverFieldGateways} value={String(info.gateways)} />
        <Row label={strings.serverFieldViewers} value={String(info.viewers)} />
        {info.primary.configured && info.mode === 'fallback' && (
          <>
            <Row label={strings.serverFieldPrimary} value={strings.primaryDown} />
            {info.primary.lastSeenAt !== null && (
              <Row
                label={strings.primaryLastSeen}
                value={`${formatRelative(info.primary.lastSeenAt)} (${formatDateTime(info.primary.lastSeenAt)})`}
              />
            )}
            {info.primary.info && (
              <Row
                label={strings.primaryLastInfo}
                value={`${info.primary.info.name} · ${info.primary.info.host ?? '—'}`}
              />
            )}
          </>
        )}
        {info.mode === 'primary' && (
          <Row
            label={strings.serverFieldSync}
            value={
              standby === null || !standby.configured
                ? strings.syncOff
                : standby.lastSyncAt === null
                  ? strings.syncNever
                  : strings.syncOk(standby.pending ?? 0, formatRelative(standby.lastSyncAt))
            }
          />
        )}
      </dl>
      {standby?.lastError && (
        <p className="mt-2 text-loss">{strings.syncError(standby.lastError)}</p>
      )}
    </div>
  )
}
