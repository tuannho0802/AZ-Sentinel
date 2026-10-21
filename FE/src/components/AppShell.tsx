import type { ReactNode } from 'react'
import { Link, useRoute } from 'wouter'
import { useLogout, useMe } from '../features/auth/api'
import { strings } from '../lib/strings'
import { Button } from './Button'
import { Logo } from './Logo'
import { ThemeToggle } from './ThemeToggle'

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const [active] = useRoute(href === '/' ? '/' : `${href}/*?`)
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`relative inline-flex h-14 items-center px-0.5 text-sm font-medium transition-colors ${
        active
          ? 'text-ink after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-accent'
          : 'text-muted hover:text-ink'
      }`}
    >
      {children}
    </Link>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const me = useMe()
  const logout = useLogout()
  return (
    <div className="min-h-screen bg-bg">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-ink focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        {strings.skipToContent}
      </a>
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-6">
            <Link href="/" className="flex shrink-0 items-center gap-2 text-ink">
              <span className="text-accent-text">
                <Logo />
              </span>
              <span className="text-[0.9375rem] font-semibold">{strings.appName}</span>
            </Link>
            <nav aria-label={strings.mainNav} className="flex items-center gap-5">
              <NavLink href="/">{strings.navOverview}</NavLink>
              {import.meta.env.DEV && <NavLink href="/links">{strings.navLinks}</NavLink>}
            </nav>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <ThemeToggle />
            {me.data && (
              <span className="hidden max-w-40 truncate px-1 text-sm text-muted sm:inline">
                {me.data.display_name}
              </span>
            )}
            <Button size="sm" disabled={logout.isPending} onClick={() => logout.mutate()}>
              {strings.logout}
            </Button>
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto max-w-7xl px-4 py-6 outline-none sm:px-6">
        {children}
      </main>
    </div>
  )
}
