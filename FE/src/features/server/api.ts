import type { ServerInfo } from '@az-sentinel/shared'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../../lib/api-client'

/**
 * Thông tin máy chủ đang phục vụ (`GET /api/server-info`, cần đăng nhập). Poll 30 giây như dashboard;
 * khi mất kết nối vẫn giữ dữ liệu cũ để biết URL dự phòng (`fallbackUrl`) mà gợi ý chuyển.
 */
export function useServerInfo() {
  return useQuery({
    queryKey: ['server-info'],
    queryFn: () => apiGet<ServerInfo>('/api/server-info'),
    refetchInterval: 30_000,
  })
}
