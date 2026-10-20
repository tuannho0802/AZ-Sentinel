import type {
  CreateLinkResponse,
  LinkDetail,
  LinkListResponse,
  LinkStatus,
  LinkSummary,
} from '@az-sentinel/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiDelete, apiGet, apiPost } from '../../lib/api-client'

const BASE = '/api/dev/links'
export const LINKS_KEY = ['links'] as const
const linkKey = (id: number) => ['links', id] as const

/** Danh sách poll 30 giây, dừng khi tab ẩn (Rules FE mục 5). */
export function useLinks() {
  return useQuery({
    queryKey: LINKS_KEY,
    queryFn: () => apiGet<LinkListResponse>(BASE),
    refetchInterval: 30_000,
  })
}

export function useLink(id: number) {
  return useQuery({
    queryKey: linkKey(id),
    queryFn: () => apiGet<LinkDetail>(`${BASE}/${id}`),
    refetchInterval: 30_000,
  })
}

/**
 * Tạo liên kết. Phản hồi chứa API key: người gọi phải lấy khóa trong callback `onSuccess`
 * của `mutate` rồi gọi `reset()` để khóa không nằm lại trong bộ nhớ đệm (Rules FE mục 4).
 */
export function useCreateLink() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => apiPost<CreateLinkResponse>(BASE, {}),
    onSuccess: () => client.invalidateQueries({ queryKey: LINKS_KEY }),
  })
}

export function useSetLinkStatus(id: number) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (status: LinkStatus) => apiPost<LinkSummary>(`${BASE}/${id}/status`, { status }),
    onSuccess: () => client.invalidateQueries({ queryKey: LINKS_KEY }),
  })
}

export function useUnbindLink(id: number) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => apiPost<LinkSummary>(`${BASE}/${id}/unbind`, {}),
    onSuccess: () => client.invalidateQueries({ queryKey: LINKS_KEY }),
  })
}

export function useDeleteLink(id: number) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => apiDelete(`${BASE}/${id}`),
    onSuccess: () => {
      client.removeQueries({ queryKey: linkKey(id) })
      return client.invalidateQueries({ queryKey: LINKS_KEY })
    },
  })
}
