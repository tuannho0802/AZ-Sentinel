import type { ReactNode } from 'react'
import { Redirect } from 'wouter'
import { Button } from '../../components/Button'
import { strings } from '../../lib/strings'
import { useMe } from './api'

/** Chỉ ẩn/hiện cho tiện dùng; phân quyền thật nằm ở BE (Rules FE mục 1). */
export function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe()
  if (me.isPending) {
    return (
      <p role="status" className="p-8 text-muted">
        {strings.checkingSession}
      </p>
    )
  }
  if (me.isError) {
    return (
      <div role="alert" className="p-8">
        <p className="text-loss">{strings.sessionError}</p>
        <Button className="mt-3" onClick={() => me.refetch()}>
          {strings.retry}
        </Button>
      </div>
    )
  }
  if (me.data === null) return <Redirect to="/login" />
  return <>{children}</>
}
