import { Route, Switch } from 'wouter'
import { RequireAuth } from './features/auth/RequireAuth'
import { DashboardPage } from './pages/DashboardPage'
import { LinkDetailPage } from './pages/LinkDetailPage'
import { LinksPage } from './pages/LinksPage'
import { LoginPage } from './pages/LoginPage'
import { NotFoundPage } from './pages/NotFoundPage'

/** Các trang liên kết EA chỉ có ở `pnpm dev` (API dev của BE); bản build không chứa chúng. */
const showLinks = import.meta.env.DEV

export function App() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route path="/">
        <RequireAuth>
          <DashboardPage />
        </RequireAuth>
      </Route>
      {showLinks && (
        <Route path="/links">
          <RequireAuth>
            <LinksPage />
          </RequireAuth>
        </Route>
      )}
      {showLinks && (
        <Route path="/links/:id">
          <RequireAuth>
            <LinkDetailPage />
          </RequireAuth>
        </Route>
      )}
      <Route component={NotFoundPage} />
    </Switch>
  )
}
