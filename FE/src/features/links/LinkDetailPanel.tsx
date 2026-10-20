import { Link } from 'wouter'
import { ApiError } from '../../lib/api-client'
import { strings } from '../../lib/strings'
import { useLink } from './api'
import { LinkDetailView } from './LinkDetailView'

export function LinkDetailPanel({ id }: { id: number }) {
  const q = useLink(id)
  const notFound = q.error instanceof ApiError && q.error.status === 404
  return (
    <div>
      <Link href="/links" className="text-sm underline">
        ← {strings.detailBack}
      </Link>
      <div className="mt-3">
        {q.isPending && <p className="text-gray-500">{strings.detailLoading}</p>}
        {q.isError && (
          <div role="alert">
            <p className="text-red-600">
              {notFound ? strings.detailNotFound : strings.detailError}
            </p>
            {!notFound && (
              <button
                type="button"
                className="mt-2 rounded border px-3 py-1"
                onClick={() => q.refetch()}
              >
                {strings.retry}
              </button>
            )}
          </div>
        )}
        {q.isSuccess && <LinkDetailView link={q.data} />}
      </div>
    </div>
  )
}
