/** Mã thiết bị trong một thẻ (tag) có viền và nền riêng, để dễ thấy và dễ đối chiếu mã 8 ký tự. */
export function DeviceTag({ id, className = '' }: { id: string; className?: string }) {
  return (
    <span
      className={`num inline-flex items-center rounded-md border border-accent-text/40 bg-raised px-2 py-0.5 font-mono text-[0.8125rem] font-semibold tracking-wide text-accent-text select-all ${className}`}
    >
      {id}
    </span>
  )
}
