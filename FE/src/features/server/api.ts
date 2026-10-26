import type { ServerInfo } from '@az-sentinel/shared'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../../lib/api-client'
import { rememberFallbackUrl } from '../../lib/failover'

export const SERVER_INFO_KEY = ['server-info'] as const

/**
 * Thông tin máy chủ đang phục vụ (`GET /api/server-info`, cần đăng nhập). Poll 60 giây; khi đang chạy dự phòng thì poll
 * 20 giây để thấy VPS và địa chỉ tunnel mới sớm. Mỗi lần poll là 1 request Worker khi vào bằng hostname Worker
 * (log 26/10/2026), và tab ẩn thì react-query tự dừng. Khi mất kết nối vẫn giữ dữ liệu cũ để biết URL
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
    refetchInterval: (query) => (query.state.data?.mode === 'fallback' ? 20_000 : 60_000),
  })
}
