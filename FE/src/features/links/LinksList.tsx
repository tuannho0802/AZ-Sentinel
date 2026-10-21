import { normalizeVpsName, VPS_NAME_MAX } from '@az-sentinel/shared'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError } from '../../lib/api-client'
import { formatTime } from '../../lib/format'
import { strings } from '../../lib/strings'
import { LINKS_KEY, useCreateLink, useLinks } from './api'
import { KeyDialog } from './KeyDialog'
import { LinksTable } from './LinksTable'
import { LiveControl } from './live/LiveControl'
import { effectiveLiveState, getLiveEntry } from './live/live-store'
import { useLiveLease } from './live/useLiveLease'

export function LinksList() {
  const client = useQueryClient()
  const links = useLinks()
  const live = useLiveLease({
    enabled: true, // route chỉ mount khi đã đăng nhập (RequireAuth)
    onResync: () => void client.invalidateQueries({ queryKey: LINKS_KEY }),
  })
  const perf = performance.now()
  const anyLive =
    links.data?.links.some(
      (l) => effectiveLiveState(getLiveEntry(l.id), live.connected, perf) === 'live',
    ) ?? false
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

  return (
    <div>
      <div className="flex items-center justify-between">
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
            <span className="text-sm text-gray-500">
              {strings.updatedAt} {formatTime(links.dataUpdatedAt)}
            </span>
          )}
          <button
            type="button"
            className="rounded border px-3 py-1"
            onClick={() => links.refetch()}
          >
            {strings.refresh}
          </button>
          <input
            aria-label={strings.vpsNamePlaceholder}
            placeholder={strings.vpsNamePlaceholder}
            className="w-48 rounded border px-2 py-1 text-sm"
            maxLength={VPS_NAME_MAX}
            value={vpsName}
            disabled={create.isPending || devOff}
            onChange={(e) => setVpsName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !create.isPending && !devOff) onCreate()
            }}
          />
          <button
            type="button"
            className="rounded bg-gray-900 px-3 py-1 text-white disabled:opacity-60"
            disabled={create.isPending || devOff}
            onClick={onCreate}
          >
            {create.isPending ? strings.linkCreating : strings.linkCreate}
          </button>
        </div>
      </div>
      <p className="mt-2 rounded bg-yellow-50 p-2 text-sm text-yellow-800">
        {strings.linksDevBanner}
      </p>
      {create.isError && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {strings.linkCreateFailed}: {create.error.message}
        </p>
      )}

      <div className="mt-4">
        {links.isPending && <p className="text-gray-500">{strings.linksLoading}</p>}
        {links.isError && (
          <div role="alert">
            <p className="text-red-600">{devOff ? strings.linksDevOff : strings.linksError}</p>
            <button
              type="button"
              className="mt-2 rounded border px-3 py-1"
              onClick={() => links.refetch()}
            >
              {strings.retry}
            </button>
          </div>
        )}
        {links.isSuccess && links.data.links.length === 0 && (
          <div className="rounded-lg border bg-white p-6 text-center">
            <p>{strings.linksEmpty}</p>
            <p className="text-sm text-gray-500">{strings.linksEmptyHint}</p>
          </div>
        )}
        {links.isSuccess && links.data.links.length > 0 && (
          <LinksTable links={links.data.links} connected={live.connected} />
        )}
      </div>

      {revealedKey && <KeyDialog apiKey={revealedKey} onClose={() => setRevealedKey(null)} />}
    </div>
  )
}
