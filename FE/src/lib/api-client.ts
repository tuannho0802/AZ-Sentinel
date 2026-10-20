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

let onUnauthorized: (() => void) | null = null

/** Đăng ký hàm chạy khi API trả 401 (trừ chính lời gọi đăng nhập). Rules FE mục 4. */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn
}

async function request<T>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    let parsed: Partial<ApiErrorBody> = {}
    try {
      parsed = (await res.json()) as ApiErrorBody
    } catch {
      // phản hồi không phải JSON chuẩn: dùng mặc định bên dưới
    }
    if (res.status === 401 && path !== '/api/auth/login') onUnauthorized?.()
    throw new ApiError(res.status, parsed.error?.code ?? 'INTERNAL', parsed.error?.message ?? 'Lỗi')
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/** Mọi lời gọi API đi qua đây (Rules FE mục 4). */
export const apiGet = <T>(path: string) => request<T>('GET', path)
export const apiPost = <T>(path: string, body?: unknown) => request<T>('POST', path, body)
export const apiDelete = (path: string) => request<void>('DELETE', path, {})
