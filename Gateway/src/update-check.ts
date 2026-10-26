import { latestRelease, RELEASES_API_URL, type UpdateInfo } from '@az-sentinel/shared'

/**
 * Kiểm tra bản Gateway mới trên GitHub Releases (tag `gateway-v*`). Chỉ để hiện thông báo trên giao diện cục bộ:
 * Gateway không tự tải hay tự thay file (người dùng chạy bộ cài mới). Logic chọn bản mới nhất dùng chung với Server
 * (`@az-sentinel/shared`); ở đây chỉ có phần gọi mạng.
 */
export { compareVersions, type UpdateInfo } from '@az-sentinel/shared'

export type UpdateOutcome =
  /** GitHub trả danh sách mới (`info` null nếu chưa có release Gateway nào). */
  | { kind: 'updated'; info: UpdateInfo | null; etag: string | null }
  /** 304: danh sách không đổi từ lần trước, giữ kết quả cũ. */
  | { kind: 'unchanged' }
  /** Lỗi mạng hoặc GitHub từ chối; `fullCycle` = đừng thử dày (hết hạn mức). */
  | { kind: 'failed'; reason: string; fullCycle: boolean }

const REQUEST_TIMEOUT_MS = 10_000

export async function fetchUpdate(
  current: string,
  opts: { etag?: string | null; fetchImpl?: typeof fetch } = {},
): Promise<UpdateOutcome> {
  const fetchImpl = opts.fetchImpl ?? fetch
  try {
    const headers: Record<string, string> = {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': `az-gateway/${current}`,
    }
    if (opts.etag) headers['if-none-match'] = opts.etag
    const res = await fetchImpl(RELEASES_API_URL, {
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (res.status === 304) {
      await res.body?.cancel()
      return { kind: 'unchanged' }
    }
    if (!res.ok) {
      await res.body?.cancel()
      return {
        kind: 'failed',
        reason: `GitHub trả HTTP ${res.status}`,
        fullCycle: res.status === 403 || res.status === 429,
      }
    }
    const list: unknown = await res.json()
    return {
      kind: 'updated',
      info: latestRelease(list, 'gateway', current),
      etag: res.headers.get('etag'),
    }
  } catch (e) {
    return {
      kind: 'failed',
      reason: (e instanceof Error ? e.message : String(e)).slice(0, 160),
      fullCycle: false,
    }
  }
}
