import type { ServerMode, ServerRole } from '@az-sentinel/shared'
import {
  SERVED_BY_HEADER,
  SERVER_MODE_HEADER,
  SERVER_MODES,
  SERVER_ROLES,
} from '@az-sentinel/shared'
import { useSyncExternalStore } from 'react'

/**
 * Máy chủ nào vừa trả lời API (Plan 3E). Mọi phản hồi `/api/*` mang header vai trò và chế độ; `api-client`
 * ghi vào đây nên giao diện biết ngay đang chạy VPS hay Cloudflare dự phòng mà không cần gọi thêm.
 * `unreachable` = lời gọi gần nhất lỗi mạng (không tới được máy chủ nào), khác với lỗi HTTP.
 */
export type ServerStatus = {
  servedBy: ServerRole | null
  mode: ServerMode | null
  unreachable: boolean
}

let status: ServerStatus = { servedBy: null, mode: null, unreachable: false }
const listeners = new Set<() => void>()

function set(next: ServerStatus): void {
  if (
    next.servedBy === status.servedBy &&
    next.mode === status.mode &&
    next.unreachable === status.unreachable
  ) {
    return
  }
  status = next
  for (const l of listeners) l()
}

const pick = <T extends string>(value: string | null, allowed: readonly T[]): T | null =>
  allowed.includes(value as T) ? (value as T) : null

/** Ghi vai trò/chế độ từ header của một phản hồi API (thiếu header thì giữ giá trị cũ). */
export function recordResponse(headers: Headers): void {
  const servedBy = pick(headers.get(SERVED_BY_HEADER), SERVER_ROLES)
  const mode = pick(headers.get(SERVER_MODE_HEADER), SERVER_MODES)
  set({
    servedBy: servedBy ?? status.servedBy,
    mode: mode ?? status.mode,
    unreachable: false,
  })
}

export function recordNetworkError(): void {
  set({ ...status, unreachable: true })
}

export function getServerStatus(): ServerStatus {
  return status
}

/** Chỉ để kiểm thử. */
export function resetServerStatus(): void {
  set({ servedBy: null, mode: null, unreachable: false })
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useServerStatus(): ServerStatus {
  return useSyncExternalStore(subscribe, getServerStatus, getServerStatus)
}
