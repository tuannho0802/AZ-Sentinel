import type { LoginRequest, MeResponse } from '@az-sentinel/shared'
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, apiGet, apiPost, setUnauthorizedHandler } from '../../lib/api-client'
import { markSessionChecked } from '../../lib/perf'
import { cacheMe, readCachedMe } from '../../lib/session-cache'

export const ME_KEY = ['me'] as const

/** Khi bất kỳ API nào trả 401, coi như đã hết phiên (Rules FE mục 4). */
export function wireAuth(client: QueryClient): void {
  setUnauthorizedHandler(() => {
    cacheMe(null)
    client.setQueryData(ME_KEY, null)
  })
}

/** Dữ liệu là `null` khi chưa đăng nhập; `isPending` khi đang kiểm tra. */
export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async (): Promise<MeResponse | null> => {
      try {
        const me = await apiGet<MeResponse>('/api/me')
        cacheMe(me)
        markSessionChecked()
        return me
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          cacheMe(null)
          markSessionChecked()
          return null
        }
        throw e
      }
    },
    staleTime: 5 * 60_000,
    // Có người dùng đã nhớ thì vẽ giao diện ngay; `initialDataUpdatedAt: 0` buộc vẫn xác nhận phiên ngầm ngay lúc mở.
    initialData: readCachedMe,
    initialDataUpdatedAt: 0,
  })
}

export function useLogin() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: LoginRequest) => apiPost<MeResponse>('/api/auth/login', body),
    onSuccess: (me) => {
      cacheMe(me)
      client.setQueryData(ME_KEY, me)
    },
  })
}

export function useLogout() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => apiPost<void>('/api/auth/logout'),
    onSuccess: () => {
      cacheMe(null)
      client.setQueryData(ME_KEY, null)
      // Xóa dữ liệu của phiên trước để không lộ sang người dùng kế tiếp.
      client.removeQueries({ predicate: (q) => q.queryKey[0] !== ME_KEY[0] })
    },
  })
}
