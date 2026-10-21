import { Link } from 'wouter'
import { Logo } from '../components/Logo'
import { strings } from '../lib/strings'

export function NotFoundPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-start justify-center gap-3 px-6">
      <span className="text-subtle">
        <Logo size={28} />
      </span>
      <h1 className="text-xl font-semibold">{strings.notFoundTitle}</h1>
      <Link
        href="/"
        className="inline-flex h-9 items-center rounded-md border border-line-strong bg-surface px-3.5 text-sm font-medium transition-colors hover:bg-raised"
      >
        {strings.backHome}
      </Link>
    </main>
  )
}