import { useEffect, useRef, useState } from 'react'
import { formatMoney, formatSigned } from '../lib/format'
import { Icon } from './Icon'

/** Hướng thay đổi của số so với lần trước, để nháy nền ngắn khi live (tắt khi giảm chuyển động). */
export function useFlash(value: number | null | undefined): string {
  const prev = useRef<number | null | undefined>(value)
  const [cls, setCls] = useState('')
  useEffect(() => {
    const before = prev.current
    prev.current = value
    if (before === null || before === undefined || value === null || value === undefined) return
    if (value === before) return
    setCls(value > before ? 'az-flash-up' : 'az-flash-down')
    const id = window.setTimeout(() => setCls(''), 900)
    return () => window.clearTimeout(id)
  }, [value])
  return cls
}

/** Số tiền kèm đơn vị; chữ số cùng độ rộng. Không có số liệu thì "—". */
export function Money({
  value,
  currency,
  className = '',
}: {
  value: number | null | undefined
  currency: string | null
  className?: string
}) {
  const flash = useFlash(value)
  return (
    <span className={`num rounded-sm ${flash} ${className}`}>{formatMoney(value, currency)}</span>
  )
}

/**
 * Lãi/lỗ: màu + dấu +/− + mũi tên (không dựa vào màu duy nhất, Rules FE mục 6). Số 0 hoặc thiếu
 * dữ liệu thì trung tính.
 */
export function Delta({
  value,
  currency,
  className = '',
}: {
  value: number | null | undefined
  currency: string | null
  className?: string
}) {
  const flash = useFlash(value)
  if (value === null || value === undefined) {
    return <span className={`num text-subtle ${className}`}>—</span>
  }
  const tone = value > 0 ? 'text-gain' : value < 0 ? 'text-loss' : 'text-muted'
  return (
    <span className={`num inline-flex items-center gap-1 rounded-sm ${tone} ${flash} ${className}`}>
      {value > 0 && <Icon name="up" size={9} />}
      {value < 0 && <Icon name="down" size={9} />}
      <span>{formatSigned(value, currency)}</span>
    </span>
  )
}
