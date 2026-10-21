/**
 * Kiểm tra bản mới trên GitHub Releases. Chỉ để hiện thông báo trên giao diện: Gateway không tự
 * tải hay tự thay file (người dùng chạy bộ cài mới). Mọi lỗi mạng bị nuốt, không ảnh hưởng chạy.
 */
export type UpdateInfo = { latest: string; url: string; available: boolean }

const REPO = 'tuannho0802/AZ-Sentinel'
const TAG_PREFIX = 'gateway-v'

/** So sánh `a` với `b` theo semver đơn giản (x.y.z). >0 nghĩa là a mới hơn. */
export function compareVersions(a: string, b: string): number {
  const pa = a
    .replace(/^v/i, '')
    .split('.')
    .map((n) => Number.parseInt(n, 10) || 0)
  const pb = b
    .replace(/^v/i, '')
    .split('.')
    .map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

export async function checkForUpdate(
  current: string,
  fetchImpl: typeof fetch = fetch,
): Promise<UpdateInfo | null> {
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${REPO}/releases?per_page=20`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'az-gateway' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const list = (await res.json()) as Array<{
      tag_name?: string
      html_url?: string
      draft?: boolean
      prerelease?: boolean
    }>
    let best: UpdateInfo | null = null
    for (const r of list) {
      if (r.draft || r.prerelease || !r.tag_name?.startsWith(TAG_PREFIX)) continue
      const v = r.tag_name.slice(TAG_PREFIX.length)
      if (!best || compareVersions(v, best.latest) > 0) {
        best = { latest: v, url: r.html_url ?? '', available: false }
      }
    }
    if (best) best.available = compareVersions(best.latest, current) > 0
    return best
  } catch {
    return null
  }
}
