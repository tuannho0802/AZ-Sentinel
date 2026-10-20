import type { HealthResponse } from '@az-sentinel/shared'
import { useQuery } from '@tanstack/react-query'
import { Card } from '../../components/Card'
import { apiGet } from '../../lib/api-client'
import { strings } from '../../lib/strings'

export function ApiStatusCard() {
  // Dashboard poll 30 giây, dừng khi tab ẩn (Rules FE mục 5).
  const q = useQuery({
    queryKey: ['health'],
    queryFn: () => apiGet<HealthResponse>('/api/health'),
    refetchInterval: 30_000,
  })
  return (
    <Card title={strings.apiStatusTitle}>
      {q.isPending && <p className="text-gray-500">{strings.apiLoading}</p>}
      {q.isError && (
        <div role="alert">
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
      {q.isSuccess && <p className="text-green-600">{strings.apiOk}</p>}
    </Card>
  )
}
