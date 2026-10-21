import { normalizeVpsName, VPS_NAME_MAX } from '@az-sentinel/shared'
import { useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Button } from '../../components/Button'
import { Icon } from '../../components/Icon'
import { Skeleton } from '../../components/Skeleton'
import { inputClass } from '../../components/styles'
import { ApiError } from '../../lib/api-client'
import { formatTime } from '../../lib/format'
import { strings } from '../../lib/strings'
import { LINKS_KEY, useCreateLink, useLinks } from './api'
import { KeyDialog } from './KeyDialog'
import { LinksSummary } from './LinksSummary'
import { LinksTable } from './LinksTable'
import { LinksToolbar } from './LinksToolbar'
import { applyView, DEFAULT_VIEW, summarize, useLinkRows, type View } from './links-view'
import { LiveBanners, LiveControl } from './live/LiveControl'
import { useLiveLease } from './live/useLiveLease'

export function LinksList() {
  const client = useQueryClient()
  const links = useLinks()
  const live = useLiveLease({
    enabled: true, // route chỉ mount khi đã đăng nhập (RequireAuth)
    onResync: () => void client.invalidateQueries({ queryKey: LINKS_KEY }),
  })
  const rows = useLinkRows(links.data?.links, live.connected)
  const summary = useMemo(() => summarize(rows), [rows])
  const [view, setView] = useState<View>(DEFAULT_VIEW)
  const shown = applyView(rows, view)
  const anyLive = summary.live > 0

  const create = useCreateLink()
  const [revealedKey, setRevealedKey] = useState<string | null>(null)
  const [vpsName, setVpsName] = useState('')

  function onCreate() {
    create.mutate(normalizeVpsName(vpsName), {
      onSuccess: (res) => {
        setVpsName('')
        setRevealedKey(res.api_key)
        // Không để khóa nằm lại trong bộ nhớ đệm của mutation.
        create.reset()
      },
    })
  }

  const devOff = links.error instanceof ApiError && links.error.status === 404
  const hasLinks = links.isSuccess && links.data.links.length > 0
  const filtered = view.query !== '' || view.filter !== 'all'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="text-xl font-semibold">{strings.linksPageTitle}</h1>
        <div className="flex flex-wrap items-center gap-3">
          <LiveControl
            status={live.status}
            anyLive={anyLive}
            kick={live.kick}
            onPause={live.pause}
            onResume={live.resume}
            onRetry={live.retry}
          />
          {links.dataUpdatedAt > 0 && (
            <span className="num text-sm text-muted">
              {strings.updatedAt} {formatTime(links.dataUpdatedAt)}
            </span>
          )}
          <Button size="sm" className="h-8" onClick={() => links.refetch()}>
            <Icon name="refresh" size={13} />
            {strings.refresh}
          </Button>
        </div>
      </div>
      <LiveBanners status={live.status} kick={live.kick} onRetry={live.retry} />

      <p className="rounded-md bg-notice-bg px-3 py-2 text-sm text-notice-ink">
        {strings.linksDevBanner}
      </p>

      {hasLinks && <LinksSummary summary={summary} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        {hasLinks ? <LinksToolbar view={view} onChange={setView} summary={summary} /> : <span />}
        <div className="flex items-center gap-2">
          <input
            aria-label={strings.vpsNamePlaceholder}
            placeholder={strings.vpsNamePlaceholder}
            className={`${inputClass} w-52`}
            maxLength={VPS_NAME_MAX}
            value={vpsName}
            disabled={create.isPending || devOff}
            onChange={(e) => setVpsName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !create.isPending && !devOff) onCreate()
            }}
          />
          <Button variant="primary" disabled={create.isPending || devOff} onClick={onCreate}>
            <Icon name="plus" size={14} />
            {create.isPending ? strings.linkCreating : strings.linkCreate}
          </Button>
        </div>
      </div>
      {create.isError && (
        <p role="alert" className="text-sm text-loss">
          {strings.linkCreateFailed}: {create.error.message}
        </p>
      )}

      <div>
        {links.isPending && <Skeleton label={strings.linksLoading} rows={5} />}
        {links.isError && (
          <div role="alert" className="rounded-lg border border-line bg-surface p-5">
            <p className="text-loss">{devOff ? strings.linksDevOff : strings.linksError}</p>
            <Button className="mt-3" onClick={() => links.refetch()}>
              {strings.retry}
            </Button>
          </div>
        )}
        {links.isSuccess && links.data.links.length === 0 && (
          <div className="rounded-lg border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
            <p className="font-medium">{strings.linksEmpty}</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted">{strings.linksEmptyHint}</p>
          </div>
        )}
        {hasLinks && shown.length > 0 && <LinksTable rows={shown} />}
        {hasLinks && shown.length === 0 && (
          <div className="rounded-lg border border-dashed border-line-strong bg-surface px-6 py-10 text-center">
            <p className="font-medium">{strings.noMatch}</p>
            {filtered && (
              <Button className="mt-3" onClick={() => setView(DEFAULT_VIEW)}>
                {strings.clearFilters}
              </Button>
            )}
          </div>
        )}
      </div>

      {revealedKey && <KeyDialog apiKey={revealedKey} onClose={() => setRevealedKey(null)} />}
    </div>
  )
}
