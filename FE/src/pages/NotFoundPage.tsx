import { Link } from 'wouter'
import { strings } from '../lib/strings'

export function NotFoundPage() {
  return (
    <main className="mx-auto max-w-sm p-8">
      <h1 className="text-xl font-semibold">{strings.notFoundTitle}</h1>
      <Link href="/" className="mt-4 inline-block underline">
        {strings.backHome}
      </Link>
    </main>
  )
}
