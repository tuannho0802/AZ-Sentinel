import type { ReactNode } from 'react'
import { Link, useRoute } from 'wouter'
import { useLogout, useMe } from '../features/auth/api'
import { NotificationBell } from '../features/notifications/NotificationBell'
import { InstallBanner } from '../features/pwa/InstallBanner'
import { FailoverBanner } from '../features/server/FailoverBanner'
import { ServerBadge } from '../features/server/ServerBadge'
import { UpdateBanner } from '../features/server/UpdateBanner'
import { strings } from '../lib/strings'
import { Button } from './Button'
import { Icon, type IconName } from './Icon'
import { Logo } from './Logo'
import { ThemeToggle } from './ThemeToggle'

/**
 * Một thanh điều hướng cho mọi cỡ màn hình: trên điện thoại nằm cố định ở đáy (icon trên, chữ dưới, vùng bấm
 * cao, ngón cái với tới), từ `md` trở lên trở về hàng liên kết trong thanh đầu.
 */
function NavLink({ href, icon, children }: { href: string; icon: IconName; children: ReactNode }) {
  const [active] = useRoute(href === '/' ? '/' : `${href}/*?`)
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-center text-[0.6875rem] leading-tight font-medium transition-colors md:h-14 md:min-h-0 md:flex-none md:flex-row md:px-0.5 md:text-sm ${
        active
          ? 'text-accent-text before:absolute before:inset-x-3 before:top-0 before:h-0.5 before:bg-accent md:text-ink md:before:inset-x-0 md:before:top-auto md:before:bottom-0'
          : 'text-muted hover:text-ink'
      }`}
    >
      <Icon name={icon} size={18} className="md:hidden" />
      <span>{children}</span>
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
      <header className="sticky top-0 z-30 border-b border-line bg-surface md:bg-surface/95 md:backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-2 px-3 sm:gap-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-6">
            <Link href="/" className="flex shrink-0 items-center gap-2 text-ink">
              <span className="text-accent-text">
                <Logo />
              </span>
              <span className="text-[0.9375rem] font-semibold">{strings.appName}</span>
            </Link>
            <nav
              aria-label={strings.mainNav}
              className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:static md:inset-auto md:z-auto md:items-center md:gap-5 md:border-0 md:bg-transparent md:pb-0"
            >
              <NavLink href="/" icon="home">
                {strings.navOverview}
              </NavLink>
              <NavLink href="/links" icon="link">
                {strings.navLinks}
              </NavLink>
              {(me.data?.role === 'admin' || me.data?.role === 'root_admin') && (
                <>
                  <NavLink href="/users" icon="users">
                    {strings.navUsers}
                  </NavLink>
                  <NavLink href="/tokens" icon="key">
                    {strings.navTokens}
                  </NavLink>
                  <NavLink href="/ip" icon="shield">
                    {strings.navIp}
                  </NavLink>
                </>
              )}
            </nav>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <ServerBadge />
            <NotificationBell />
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
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto max-w-7xl px-3 pt-4 pb-28 outline-none sm:px-6 md:py-6"
      >
        <FailoverBanner />
        <UpdateBanner />
        <InstallBanner />
        {children}
      </main>
    </div>
  )
}
