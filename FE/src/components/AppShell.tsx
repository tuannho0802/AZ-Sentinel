import type { ReactNode } from 'react'
import { Link, useRoute } from 'wouter'
import { useLogout, useMe } from '../features/auth/api'
import { strings } from '../lib/strings'

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const [active] = useRoute(href === '/' ? '/' : `${href}/*?`)
  return (
    <Link href={href} className={active ? 'font-semibold underline' : 'text-gray-600'}>
      {children}
    </Link>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const me = useMe()
  const logout = useLogout()
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between border-b bg-white px-6 py-3">
        <div className="flex items-center gap-6">
          <span className="font-semibold">{strings.appName}</span>
          <nav className="flex gap-4 text-sm">
            <NavLink href="/">{strings.navOverview}</NavLink>
            {import.meta.env.DEV && <NavLink href="/links">{strings.navLinks}</NavLink>}
          </nav>
        </div>
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
