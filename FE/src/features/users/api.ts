import type {
    CreateUserRequest,
    UpdateUserRequest,
    UserListResponse,
    UserResponse,
} from '@az-sentinel/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPatch, apiPost } from '../../lib/api-client'

const BASE = '/api/admin/users'
export const USERS_KEY = ['users'] as const

/** Danh sách người dùng (chỉ quản trị viên; người khác nhận 403). Không tự poll. */
export function useUsers() {
    return useQuery({
        queryKey: USERS_KEY,
        queryFn: () => apiGet<UserListResponse>(BASE),
    })
}

export function useCreateUser() {
    const client = useQueryClient()
    return useMutation({
        mutationFn: (body: CreateUserRequest) => apiPost<UserResponse>(BASE, body),
        onSuccess: () => client.invalidateQueries({ queryKey: USERS_KEY }),
    })
}

/** Sửa tên, vai trò, trạng thái hoặc đặt lại mật khẩu. Khóa người dùng cũng làm token của họ đổi. */
export function useUpdateUser() {
    const client = useQueryClient()
    return useMutation({
        mutationFn: ({ id, ...body }: UpdateUserRequest & { id: number }) =>
            apiPatch<UserResponse>(`${BASE}/${id}`, body),
        onSuccess: () => {
            client.invalidateQueries({ queryKey: USERS_KEY })
            client.invalidateQueries({ queryKey: ['gw-tokens'] })
        },
    })
}