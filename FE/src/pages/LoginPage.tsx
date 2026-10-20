import { Redirect } from 'wouter'
import { useMe } from '../features/auth/api'
import { DevAuthHint } from '../features/auth/DevAuthHint'
import { LoginForm } from '../features/auth/LoginForm'
import { strings } from '../lib/strings'

export function LoginPage() {
  const me = useMe()
  if (me.data) return <Redirect to="/" />
  return (
    <main className="mx-auto max-w-sm p-8">
      <h1 className="text-2xl font-semibold">{strings.appName}</h1>
      <h2 className="mt-1 text-gray-600">{strings.loginTitle}</h2>
      <LoginForm />
      {import.meta.env.DEV && <DevAuthHint />}
    </main>
  )
}
