import type {
  CreateLinkResponse,
  LinkDetail,
  LinkListResponse,
  LinkStatus,
  LinkSummary,
  TradeRequest,
} from '@az-sentinel/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiDelete, apiGet, apiPost } from '../../lib/api-client'

const BASE = '/api/links'
export const LINKS_KEY = ['links'] as const
export const linkKey = (id: number) => ['links', id] as const

/**
 * Chu kỳ tự làm mới do người dùng chọn trên màn hình thử (xem `refresh.ts`); 0 = tắt.
 * Luôn dừng khi tab ẩn (Rules FE mục 5).
 */
export function useLinks() {
  // Danh sách KHÔNG tự poll: dữ liệu sống đến qua WebSocket (Plan 3B). Làm mới D1 chỉ khi vào
  // trang, khi nối lại, hoặc khi người dùng bấm Làm mới (Rules FE mục 5).
  return useQuery({
    queryKey: LINKS_KEY,
    queryFn: () => apiGet<LinkListResponse>(BASE),
  })
}

/**
 * Một liên kết (D1): tải một lần khi vào trang, khi nối lại, hoặc khi bấm Làm mới. KHÔNG tự poll:
 * số liệu sống của đúng liên kết này đến qua WebSocket `scope=link` (Plan 3C).
 */
export function useLink(id: number) {
  return useQuery({
    queryKey: linkKey(id),
    queryFn: () => apiGet<LinkDetail>(`${BASE}/${id}`),
  })
}

/**
 * Tạo liên kết. Phản hồi chứa API key: người gọi phải lấy khóa trong callback `onSuccess`
 * của `mutate` rồi gọi `reset()` để khóa không nằm lại trong bộ nhớ đệm (Rules FE mục 4).
 */
export function useCreateLink() {
  const client = useQueryClient()
  return useMutation({
    // Tên VPS là tùy chọn: không nhập thì gửi thân rỗng như trước.
    mutationFn: (vpsName?: string | null) =>
      apiPost<CreateLinkResponse>(BASE, vpsName ? { vps_name: vpsName } : {}),
    onSuccess: () => client.invalidateQueries({ queryKey: LINKS_KEY }),
  })
}

/** Đặt/đổi tên VPS của một liên kết (null = xóa tên). Cập nhật cả danh sách lẫn trang chi tiết. */
export function useSetVpsName(id: number) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (vpsName: string | null) =>
      apiPost<LinkSummary>(`${BASE}/${id}/vps-name`, { vps_name: vpsName }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: linkKey(id) })
      return client.invalidateQueries({ queryKey: LINKS_KEY })
    },
  })
}

/** Cấp lại khóa; cũng phải lấy khóa trong `onSuccess` của `mutate` rồi `reset()`. */
export function useRotateKey(id: number) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => apiPost<CreateLinkResponse>(`${BASE}/${id}/rotate-key`, {}),
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

/** Bật/tắt giao dịch thủ công từ xa của liên kết (chỉ admin; mặc định tắt). */
export function useSetTradeEnabled(id: number) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (enabled: boolean) =>
      apiPost<LinkSummary>(`${BASE}/${id}/trade-enabled`, { enabled }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: linkKey(id) })
      return client.invalidateQueries({ queryKey: LINKS_KEY })
    },
  })
}

export type TradeAccepted = { cmd_id: string; op: TradeRequest['op']; ticket: number }

/**
 * Gửi lệnh giao dịch thủ công. Phản hồi 202 chỉ nghĩa là lệnh đã được chuyển đi; kết quả thật (retcode của
 * MT5) đến sau qua WebSocket (`trade_result`, xem `getTradeResult`). Không tự thử lại: gửi trùng là rủi ro.
 */
export function useSendTrade(id: number) {
  return useMutation({
    retry: false,
    mutationFn: (req: TradeRequest) => apiPost<TradeAccepted>(`${BASE}/${id}/trade`, req),
  })
}
