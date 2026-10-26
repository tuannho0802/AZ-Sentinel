import type {
  AlertSettings,
  AlertSettingsInput,
  MarkReadRequest,
  NotificationListResponse,
} from '@az-sentinel/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiPut } from '../../lib/api-client'

export const NOTIFICATIONS_KEY = ['notifications'] as const
export const ALERT_SETTINGS_KEY = ['alert-settings'] as const

/** Nhịp hỏi thông báo mới (ms). Không dưới 30 giây (Rules FE mục 5); tab ẩn thì tự dừng. */
const POLL_MS = 60_000

/** Thông báo mới nhất của chính người đăng nhập, kèm số chưa đọc cho chuông. */
export function useNotifications() {
  return useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: () => apiGet<NotificationListResponse>('/api/notifications?limit=30'),
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
  })
}

export function useMarkRead() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: MarkReadRequest) =>
      apiPost<{ unread: number }>('/api/notifications/read', body),
    onSuccess: () => client.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  })
}

/** Chỉ tải khi người dùng mở phần cài đặt (`enabled`), không tốn request lúc chỉ xem chuông. */
export function useAlertSettings(enabled: boolean) {
  return useQuery({
    queryKey: ALERT_SETTINGS_KEY,
    queryFn: () => apiGet<AlertSettings>('/api/settings/alerts'),
    enabled,
  })
}

export function useSaveAlertSettings() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: AlertSettingsInput) => apiPut<AlertSettings>('/api/settings/alerts', body),
    onSuccess: (saved) => client.setQueryData(ALERT_SETTINGS_KEY, saved),
  })
}
