/** Khung xương cho trạng thái đang tải (Rules FE mục 8). Có `role="status"` để trình đọc màn hình biết. */
export function Skeleton({ label, rows = 4 }: { label: string; rows?: number }) {
  const keys = Array.from({ length: rows }, (_, i) => `sk-${i}`)
  return (
    <div role="status" aria-label={label} className="space-y-2">
      {keys.map((k) => (
        <div key={k} className="az-skeleton h-11 rounded-md bg-raised" />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  )
}
