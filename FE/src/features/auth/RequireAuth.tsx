import { type ReactNode, useEffect } from 'react'
import { Redirect } from 'wouter'
import { Button } from '../../components/Button'
import { markShown } from '../../lib/perf'
import { strings } from '../../lib/strings'
import { FailoverBanner } from '../server/FailoverBanner'
import { useMe } from './api'

/** Chỉ ẩn/hiện cho tiện dùng; phân quyền thật nằm ở BE (Rules FE mục 1). */
export function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe()
  const ready = !me.isPending
  useEffect(() => {
    if (ready) markShown()
  }, [ready])
  if (me.isPending) {
    return (
      <p role="status" className="p-8 text-muted">
        {strings.checkingSession}
      </p>
    )
  }
  // Làm mới phiên thất bại (VPS vừa sập) nhưng đã có người dùng từ trước: giữ nguyên giao diện, banner lo phần còn lại.
  if (me.isError && me.data === undefined) {
    return (
      <div className="p-8">
        <FailoverBanner />
        <p role="alert" className="text-loss">
          {strings.sessionError}
        </p>
        <Button className="mt-3" onClick={() => me.refetch()}>
          {strings.retry}
        </Button>
      </div>
    )
  }
  if (me.data === null) return <Redirect to="/login" />
  return <>{children}</>
}
