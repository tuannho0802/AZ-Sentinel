import type { ReactNode } from 'react'

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border bg-white p-4 shadow-sm">
      <h2 className="text-sm font-medium text-gray-500">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  )
}
