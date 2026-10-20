import { useEffect, useState } from 'react'

/** Đồng hồ cục bộ (không gọi API) để các nhãn "x giây trước" tự cập nhật. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}
