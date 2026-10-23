import type { ServerInfo } from '@az-sentinel/shared'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { apiGet } from '../../lib/api-client'
import {
  failoverTarget,
  GRACE_SEC,
  goTo,
  isReachable,
  PROBE_EVERY_SEC,
  readFallbackUrl,
  resetFailoverState,
  setFailoverState,
} from '../../lib/failover'
import { useServerStatus } from '../../lib/server-status'
import { SERVER_INFO_KEY } from './api'

/**
 * Không vẽ gì; chạy ở gốc ứng dụng (cả trang đăng nhập). Khi không gọi được máy chủ đang phục vụ trang:
 * dò lại mỗi vài giây; vẫn mất kết nối sau thời gian chờ thì chuyển sang bản dự phòng (nếu bản đó đang trả lời).
 */
export function FailoverWatcher() {
  const { unreachable } = useServerStatus()
  const client = useQueryClient()

  useEffect(() => {
    if (!unreachable) {
      resetFailoverState()
      return
    }
    let stopped = false
    let busy = false
    let fallbackDown = false
    const startedAt = Date.now()

    const tick = async () => {
      if (stopped || busy) return
      const elapsed = Math.floor((Date.now() - startedAt) / 1000)
      const known =
        client.getQueryData<ServerInfo>(SERVER_INFO_KEY)?.fallbackUrl ?? readFallbackUrl()
      const target = failoverTarget(known, window.location)
      setFailoverState(
        target === null
          ? { redirectInSec: null, fallbackDown: false }
          : { redirectInSec: Math.max(0, GRACE_SEC - elapsed), fallbackDown },
      )
      if (elapsed % PROBE_EVERY_SEC !== 0) return
      busy = true
      try {
        // Thành công thì api-client tự đưa trạng thái về bình thường và effect này dừng lại.
        await apiGet('/api/health')
        return
      } catch {
        // vẫn không tới được máy chủ này
      } finally {
        busy = false
      }
      if (stopped || target === null || elapsed < GRACE_SEC) return
      if (await isReachable(new URL(target).origin)) {
        if (!stopped) goTo(target)
      } else {
        fallbackDown = true
      }
    }

    void tick()
    const timer = setInterval(() => void tick(), 1000)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [unreachable, client])

  return null
}
