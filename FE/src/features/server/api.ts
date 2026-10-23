import type { ServerInfo } from '@az-sentinel/shared'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../../lib/api-client'
import { rememberFallbackUrl } from '../../lib/failover'

export const SERVER_INFO_KEY = ['server-info'] as const

/**
 * Thông tin máy chủ đang phục vụ (`GET /api/server-info`, cần đăng nhập). Poll 30 giây như dashboard; khi đang chạy
 * dự phòng thì poll 10 giây để thấy VPS và địa chỉ tunnel mới sớm. Khi mất kết nối vẫn giữ dữ liệu cũ để biết URL
 * dự phòng (`fallbackUrl`) mà chuyển sang.
 */
export function useServerInfo() {
  return useQuery({
    queryKey: SERVER_INFO_KEY,
    queryFn: async () => {
      const info = await apiGet<ServerInfo>('/api/server-info')
      rememberFallbackUrl(info.fallbackUrl)
      return info
    },
    refetchInterval: (query) => (query.state.data?.mode === 'fallback' ? 10_000 : 30_000),
  })
}
