import type { LoginRequest, MeResponse } from '@az-sentinel/shared'
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, apiGet, apiPost, setUnauthorizedHandler } from '../../lib/api-client'

export const ME_KEY = ['me'] as const

/** Khi bất kỳ API nào trả 401, coi như đã hết phiên (Rules FE mục 4). */
export function wireAuth(client: QueryClient): void {
  setUnauthorizedHandler(() => client.setQueryData(ME_KEY, null))
}

/** Dữ liệu là `null` khi chưa đăng nhập; `isPending` khi đang kiểm tra. */
export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async (): Promise<MeResponse | null> => {
      try {
        return await apiGet<MeResponse>('/api/me')
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null
        throw e
      }
    },
    staleTime: 5 * 60_000,
  })
}

export function useLogin() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: LoginRequest) => apiPost<MeResponse>('/api/auth/login', body),
    onSuccess: (me) => client.setQueryData(ME_KEY, me),
  })
}

export function useLogout() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => apiPost<void>('/api/auth/logout'),
    onSuccess: () => {
      client.setQueryData(ME_KEY, null)
      // Xóa dữ liệu của phiên trước để không lộ sang người dùng kế tiếp.
      client.removeQueries({ predicate: (q) => q.queryKey[0] !== ME_KEY[0] })
    },
  })
}
