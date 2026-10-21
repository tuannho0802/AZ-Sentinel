import type { HealthResponse } from '@az-sentinel/shared'
import { useQuery } from '@tanstack/react-query'
import { Button } from '../../components/Button'
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
      {q.isPending && <p className="text-muted">{strings.apiLoading}</p>}
      {q.isError && (
        <div role="alert">
          <p className="text-loss">{strings.apiError}</p>
          <Button className="mt-3" onClick={() => q.refetch()}>
            {strings.retry}
          </Button>
        </div>
      )}
      {q.isSuccess && (
        <p className="inline-flex items-center gap-2 font-medium text-gain">
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-gain" />
          {strings.apiOk}
        </p>
      )}
    </Card>
  )
}
