import type { ReactNode } from 'react'
import { Redirect } from 'wouter'
import { strings } from '../../lib/strings'
import { useMe } from './api'

/** Chỉ ẩn/hiện cho tiện dùng; phân quyền thật nằm ở BE (Rules FE mục 1). */
export function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe()
  if (me.isPending) {
    return (
      <p role="status" className="p-8 text-gray-500">
        {strings.checkingSession}
      </p>
    )
  }
  if (me.isError) {
    return (
      <div role="alert" className="p-8">
        <p className="text-red-600">{strings.sessionError}</p>
        <button
          type="button"
          className="mt-2 rounded border px-3 py-1"
          onClick={() => me.refetch()}
        >
          {strings.retry}
        </button>
      </div>
    )
  }
  if (me.data === null) return <Redirect to="/login" />
  return <>{children}</>
}
