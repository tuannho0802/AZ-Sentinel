import type { ApiErrorBody } from '@az-sentinel/shared'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** Mọi lời gọi API đi qua đây (Rules FE mục 4). */
export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin' })
  if (!res.ok) {
    let body: Partial<ApiErrorBody> = {}
    try {
      body = (await res.json()) as ApiErrorBody
    } catch {
      // phản hồi không phải JSON chuẩn: dùng mặc định bên dưới
    }
    throw new ApiError(res.status, body.error?.code ?? 'INTERNAL', body.error?.message ?? 'Lỗi')
  }
  return (await res.json()) as T
}
