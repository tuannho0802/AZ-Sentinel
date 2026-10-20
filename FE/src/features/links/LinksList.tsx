import { useState } from 'react'
import { ApiError } from '../../lib/api-client'
import { strings } from '../../lib/strings'
import { useCreateLink, useLinks } from './api'
import { KeyDialog } from './KeyDialog'
import { LinksTable } from './LinksTable'

export function LinksList() {
  const links = useLinks()
  const create = useCreateLink()
  const [revealedKey, setRevealedKey] = useState<string | null>(null)

  function onCreate() {
    create.mutate(undefined, {
      onSuccess: (res) => {
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
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded border px-3 py-1"
            onClick={() => links.refetch()}
          >
            {strings.refresh}
          </button>
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
        {links.isSuccess && links.data.links.length > 0 && <LinksTable links={links.data.links} />}
      </div>

      {revealedKey && <KeyDialog apiKey={revealedKey} onClose={() => setRevealedKey(null)} />}
    </div>
  )
}
