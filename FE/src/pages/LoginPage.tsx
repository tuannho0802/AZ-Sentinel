import { Redirect } from 'wouter'
import { Logo } from '../components/Logo'
import { ThemeToggle } from '../components/ThemeToggle'
import { useMe } from '../features/auth/api'
import { DevAuthHint } from '../features/auth/DevAuthHint'
import { LoginForm } from '../features/auth/LoginForm'
import { strings } from '../lib/strings'

export function LoginPage() {
  const me = useMe()
  if (me.data) return <Redirect to="/" />
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-bg px-4 py-10">
      <div className="absolute top-3 right-3">
        <ThemeToggle />
      </div>
      <main className="w-full max-w-sm">
        <div className="flex items-center gap-2.5 text-accent-text">
          <Logo size={30} />
          <h1 className="text-2xl font-semibold text-ink">{strings.appName}</h1>
        </div>
        <p className="mt-2 text-muted">{strings.loginIntro}</p>
        <div className="mt-6 rounded-xl border border-line bg-surface p-6">
          <h2 className="text-lg font-semibold">{strings.loginTitle}</h2>
          <LoginForm />
        </div>
        {import.meta.env.DEV && <DevAuthHint />}
      </main>
    </div>
  )
}
