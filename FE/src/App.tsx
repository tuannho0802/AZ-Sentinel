import { Route, Switch } from 'wouter'
import { RequireAuth } from './features/auth/RequireAuth'
import { DashboardPage } from './pages/DashboardPage'
import { LoginPage } from './pages/LoginPage'
import { NotFoundPage } from './pages/NotFoundPage'

export function App() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route path="/">
        <RequireAuth>
          <DashboardPage />
        </RequireAuth>
      </Route>
      <Route component={NotFoundPage} />
    </Switch>
  )
}
