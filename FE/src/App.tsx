import { lazy, Suspense } from 'react'
import { Route, Switch } from 'wouter'
import { RequireAuth } from './features/auth/RequireAuth'
import { FailoverWatcher } from './features/server/FailoverWatcher'
import { strings } from './lib/strings'
import { DashboardPage } from './pages/DashboardPage'
import { LoginPage } from './pages/LoginPage'
import { NotFoundPage } from './pages/NotFoundPage'

// Trang phụ tải khi cần: gói đầu (Đăng nhập + Tổng quan) nhẹ hơn nên điện thoại vào Dashboard nhanh hơn.
const IpPage = lazy(() => import('./pages/IpPage').then((m) => ({ default: m.IpPage })))
const LinkDetailPage = lazy(() =>
  import('./pages/LinkDetailPage').then((m) => ({ default: m.LinkDetailPage })),
)
const LinksPage = lazy(() => import('./pages/LinksPage').then((m) => ({ default: m.LinksPage })))
const TokensPage = lazy(() => import('./pages/TokensPage').then((m) => ({ default: m.TokensPage })))
const UsersPage = lazy(() => import('./pages/UsersPage').then((m) => ({ default: m.UsersPage })))

export function App() {
  return (
    <>
      <FailoverWatcher />
      <Suspense
        fallback={
          <p role="status" className="p-8 text-muted">
            {strings.pageLoading}
          </p>
        }
      >
        <Switch>
          <Route path="/login" component={LoginPage} />
          <Route path="/">
            <RequireAuth>
              <DashboardPage />
            </RequireAuth>
          </Route>
          <Route path="/links">
            <RequireAuth>
              <LinksPage />
            </RequireAuth>
          </Route>
          <Route path="/links/:id">
            <RequireAuth>
              <LinkDetailPage />
            </RequireAuth>
          </Route>
          <Route path="/tokens">
            <RequireAuth>
              <TokensPage />
            </RequireAuth>
          </Route>
          <Route path="/ip">
            <RequireAuth>
              <IpPage />
            </RequireAuth>
          </Route>
          <Route path="/users">
            <RequireAuth>
              <UsersPage />
            </RequireAuth>
          </Route>
          <Route component={NotFoundPage} />
        </Switch>
      </Suspense>
    </>
  )
}
