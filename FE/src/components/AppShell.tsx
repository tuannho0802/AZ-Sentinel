import type { ReactNode } from 'react'
import { useLogout, useMe } from '../features/auth/api'
import { strings } from '../lib/strings'

export function AppShell({ children }: { children: ReactNode }) {
  const me = useMe()
  const logout = useLogout()
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between border-b bg-white px-6 py-3">
        <span className="font-semibold">{strings.appName}</span>
        <div className="flex items-center gap-3 text-sm">
          {me.data && <span>{me.data.display_name}</span>}
          <button
            type="button"
            className="rounded border px-3 py-1 disabled:opacity-60"
            disabled={logout.isPending}
            onClick={() => logout.mutate()}
          >
            {strings.logout}
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-4xl p-6">{children}</main>
    </div>
  )
}
