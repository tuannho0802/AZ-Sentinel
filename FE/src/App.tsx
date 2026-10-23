import { Route, Switch } from 'wouter'
import { RequireAuth } from './features/auth/RequireAuth'
import { FailoverWatcher } from './features/server/FailoverWatcher'
import { DashboardPage } from './pages/DashboardPage'
import { IpPage } from './pages/IpPage'
import { LinkDetailPage } from './pages/LinkDetailPage'
import { LinksPage } from './pages/LinksPage'
import { LoginPage } from './pages/LoginPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { TokensPage } from './pages/TokensPage'
import { UsersPage } from './pages/UsersPage'

export function App() {
  return (
    <>
      <FailoverWatcher />
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
    </>
  )
}
