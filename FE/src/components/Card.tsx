import type { ReactNode } from 'react'

/** Khung nội dung phẳng: viền mảnh, không đổ bóng. Tiêu đề viết thường, không in hoa. */
export function Card({
  title,
  children,
  action,
}: {
  title: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <section className="rounded-lg border border-line bg-surface">
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  )
}