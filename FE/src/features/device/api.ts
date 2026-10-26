import type {
  CreateDeviceRuleRequest,
  DeviceGuardState,
  DeviceRule,
  UpdateDeviceRuleRequest,
} from '@az-sentinel/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from '../../lib/api-client'
import { IP_KEY } from '../ip/api'

const BASE = '/api/admin/device-rules'
export const DEVICE_KEY = ['device-rules'] as const

/** Whitelist thiết bị (chỉ quản trị viên). Không tự poll; thay đổi xong thì tải lại. */
export function useDeviceState() {
  return useQuery({ queryKey: DEVICE_KEY, queryFn: () => apiGet<DeviceGuardState>(BASE) })
}

/** Duyệt/gỡ thiết bị có thể thêm hoặc gỡ IP trong whitelist IP, nên tải lại cả hai. */
function useRefresh() {
  const client = useQueryClient()
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: DEVICE_KEY }),
      client.invalidateQueries({ queryKey: IP_KEY }),
    ])
}

export function useAddDevice() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (body: Partial<CreateDeviceRuleRequest> & { device_id: string }) =>
      apiPost<{ rule: DeviceRule }>(BASE, body),
    onSuccess: refresh,
  })
}

export function useUpdateDevice() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (v: { id: number; body: UpdateDeviceRuleRequest }) =>
      apiPatch<{ rule: DeviceRule }>(`${BASE}/${v.id}`, v.body),
    onSuccess: refresh,
  })
}

export function useRemoveDevice() {
  const refresh = useRefresh()
  return useMutation({ mutationFn: (id: number) => apiDelete(`${BASE}/${id}`), onSuccess: refresh })
}

export function useDismissPending() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (deviceId: string) => apiDelete(`${BASE}/pending/${deviceId}`),
    onSuccess: refresh,
  })
}

export function useSetDeviceGuard() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (enforce: boolean) => apiPut<DeviceGuardState>(`${BASE}/guard`, { enforce }),
    onSuccess: refresh,
  })
}
