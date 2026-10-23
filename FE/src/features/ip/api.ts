import type {
  CreateIpRuleRequest,
  IpGuardState,
  IpRule,
  UpdateIpRuleRequest,
} from '@az-sentinel/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from '../../lib/api-client'

const BASE = '/api/admin/ip-rules'
export const IP_KEY = ['ip-rules'] as const

/** Whitelist IP (chỉ quản trị viên). Không tự poll; thay đổi xong thì tải lại. */
export function useIpState() {
  return useQuery({ queryKey: IP_KEY, queryFn: () => apiGet<IpGuardState>(BASE) })
}

function useRefresh() {
  const client = useQueryClient()
  return () => client.invalidateQueries({ queryKey: IP_KEY })
}

export function useAddIp() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (body: Partial<CreateIpRuleRequest> & { ip: string }) =>
      apiPost<{ rule: IpRule }>(BASE, body),
    onSuccess: refresh,
  })
}

export function useUpdateIp() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (v: { id: number; body: UpdateIpRuleRequest }) =>
      apiPatch<{ rule: IpRule }>(`${BASE}/${v.id}`, v.body),
    onSuccess: refresh,
  })
}

export function useRemoveIp() {
  const refresh = useRefresh()
  return useMutation({ mutationFn: (id: number) => apiDelete(`${BASE}/${id}`), onSuccess: refresh })
}

export function useSetGuard() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (enforce: boolean) => apiPut<IpGuardState>(`${BASE}/guard`, { enforce }),
    onSuccess: refresh,
  })
}
