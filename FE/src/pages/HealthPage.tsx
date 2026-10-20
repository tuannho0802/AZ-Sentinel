import type { HealthResponse } from '@az-sentinel/shared'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../lib/api-client'
import { strings } from '../lib/strings'

export function HealthPage() {
  const q = useQuery({ queryKey: ['health'], queryFn: () => apiGet<HealthResponse>('/api/health') })

  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-2xl font-semibold">{strings.appName}</h1>
      {q.isPending && <p className="mt-4 text-gray-500">{strings.apiLoading}</p>}
      {q.isError && (
        <div className="mt-4" role="alert">
          <p className="text-red-600">{strings.apiError}</p>
          <button
            type="button"
            className="mt-2 rounded border px-3 py-1"
            onClick={() => q.refetch()}
          >
            {strings.retry}
          </button>
        </div>
      )}
      {q.isSuccess && <p className="mt-4 text-green-600">{strings.apiOk}</p>}
    </main>
  )
}
