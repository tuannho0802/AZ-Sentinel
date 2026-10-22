import type {
  CreateGwTokenRequest,
  GwTokenListResponse,
  GwTokenSecretResponse,
  GwTokenSummary,
} from '@az-sentinel/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost } from '../../lib/api-client'

const BASE = '/api/admin/gw-tokens'
export const TOKENS_KEY = ['gw-tokens'] as const

/** Danh sách token (không có token thô). Chỉ quản trị viên; người khác nhận 403. Không tự poll. */
export function useTokens() {
  return useQuery({
    queryKey: TOKENS_KEY,
    queryFn: () => apiGet<GwTokenListResponse>(BASE),
  })
}

/**
 * Cấp token. Phản hồi chứa token thô: người gọi lấy trong `onSuccess` của `mutate` rồi gọi `reset()` để
 * token không nằm lại trong bộ nhớ đệm (Rules FE mục 4).
 */
export function useIssueToken() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateGwTokenRequest) => apiPost<GwTokenSecretResponse>(BASE, body),
    onSuccess: () => client.invalidateQueries({ queryKey: TOKENS_KEY }),
  })
}

export function useResetToken() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => apiPost<GwTokenSecretResponse>(`${BASE}/${id}/reset`, {}),
    onSuccess: () => client.invalidateQueries({ queryKey: TOKENS_KEY }),
  })
}

export function useRevokeToken() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => apiPost<{ summary: GwTokenSummary }>(`${BASE}/${id}/revoke`, {}),
    onSuccess: () => client.invalidateQueries({ queryKey: TOKENS_KEY }),
  })
}
