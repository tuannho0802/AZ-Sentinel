import type { ReactNode } from 'react'

/** Một cặp nhãn–giá trị trong thẻ mobile: nhãn nhỏ phía trên, giá trị bên dưới. */
export function Field({
  label,
  children,
  className = '',
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 min-w-0 text-sm break-words">{children}</dd>
    </div>
  )
}

/**
 * Thẻ thay cho một dòng bảng trên điện thoại: phần đầu (nhận diện + trạng thái), lưới thông tin,
 * phần thao tác ở đáy với nút cao dễ chạm. `stripe` là lớp màu viền trái (giữ cách đọc nhanh như dòng bảng).
 */
export function MobileCard({
  head,
  children,
  actions,
  stripe = 'border-l-transparent',
  tone = '',
  dense = false,
}: {
  head: ReactNode
  children?: ReactNode
  actions?: ReactNode
  stripe?: string
  tone?: string
  /** Thẻ gọn: bớt khoảng đệm để một màn hình điện thoại xem được nhiều thẻ hơn. */
  dense?: boolean
}) {
  return (
    <li
      className={`relative overflow-hidden rounded-lg border border-l-[3px] border-line bg-surface ${stripe} ${tone}`}
    >
      <div
        className={`flex items-start justify-between gap-3 ${dense ? 'px-3 pt-2.5' : 'px-3.5 pt-3'}`}
      >
        {head}
      </div>
      {children && (
        <div className={dense ? 'px-3 pt-2 pb-2.5' : 'px-3.5 pt-3 pb-3.5'}>{children}</div>
      )}
      {actions && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line bg-raised/50 px-3.5 py-2.5">
          {actions}
        </div>
      )}
    </li>
  )
}

export function MobileCardList({ children, label }: { children: ReactNode; label: string }) {
  return (
    <ul aria-label={label} className="space-y-2.5">
      {children}
    </ul>
  )
}
