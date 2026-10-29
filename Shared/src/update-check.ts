import { z } from 'zod'

/**
 * Báo bản cập nhật cho bộ cài (Server và Gateway trên VPS). Nguồn sự thật là GitHub Releases của dự án; hai
 * workflow release đặt tên tag `server-v<x.y.z>` và `gateway-v<x.y.z>`. Ở đây chỉ có phần thuần (không gọi mạng):
 * hằng số, schema và cách chọn bản mới nhất, để Server, Gateway và FE dùng chung một cách hiểu.
 */

export const RELEASE_REPO = 'tuannho0802/AZ-Sentinel'
/** Trang tải bộ cài (dùng khi release không kèm địa chỉ riêng). */
export const RELEASES_PAGE_URL = `https://github.com/${RELEASE_REPO}/releases`
/** 100 bản gần nhất: tag `server-v*` và `gateway-v*` nằm chung một danh sách nên 20 bản có thể không chứa bản của loại kia. */
export const RELEASES_API_URL = `https://api.github.com/repos/${RELEASE_REPO}/releases?per_page=100`

export const RELEASE_TAG_PREFIX = { gateway: 'gateway-v', server: 'server-v' } as const
export type ReleaseKind = keyof typeof RELEASE_TAG_PREFIX

/** Chu kỳ hỏi GitHub của Server và Gateway (giây): 5 phút. Có ETag nên lần không đổi là 304, không tốn hạn mức. */
export const UPDATE_CHECK_SEC = 300
/** Lỗi mạng thì thử lại sớm hơn chu kỳ thường (giây). */
export const UPDATE_RETRY_SEC = 120

export const updateInfoSchema = z.object({
  /** Phiên bản mới nhất đã phát hành, dạng `x.y.z` (không có tiền tố tag). */
  latest: z.string().max(32),
  /** Trang release để tải bộ cài mới. Luôn là địa chỉ github.com của dự án. */
  url: z.string().max(256),
  /** `latest` mới hơn bản đang chạy. */
  available: z.boolean(),
})
export type UpdateInfo = z.infer<typeof updateInfoSchema>

/**
 * Kết quả kiểm tra của bộ cài Server, gắn vào `GET /api/server-info` để giao diện web hiện banner.
 * Mỗi bộ cài chỉ biết phiên bản của chính nó: Server báo bản Server (ở đây), Gateway tự báo bản Gateway
 * trên giao diện cục bộ của nó (`/v1/ui/update`).
 */
export const updateStatusSchema = z.object({
  /** null khi chưa kiểm tra được (chưa xong lần đầu, mất mạng) hoặc chưa có release `server-v*` nào. */
  server: updateInfoSchema.nullable(),
  /** Unix giây lần kiểm tra thành công gần nhất; null nếu chưa lần nào. */
  checkedAt: z.number().int().nullable(),
})
export type UpdateStatus = z.infer<typeof updateStatusSchema>

const STRICT_SEMVER = /^\d+\.\d+\.\d+$/

/** Chỉ nhận `x.y.z` thuần (bỏ `v` đầu). Bản dev (`dev`, `0.1.0-beta`...) không phải phiên bản phát hành. */
export function isReleaseVersion(v: string | undefined | null): v is string {
  return typeof v === 'string' && STRICT_SEMVER.test(v.replace(/^v/i, ''))
}

/** So `a` với `b` theo x.y.z (bỏ `v` đầu). Lớn hơn 0 nghĩa là `a` mới hơn. */
export function compareVersions(a: string, b: string): number {
  const parse = (s: string) =>
    s
      .replace(/^v/i, '')
      .split('.')
      .map((n) => Number.parseInt(n, 10) || 0)
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** Địa chỉ chỉ nhận khi trỏ về chính repo của dự án (giao diện đưa nó vào `href`, không tin dữ liệu ngoài). */
function safeReleaseUrl(raw: unknown): string {
  return typeof raw === 'string' && raw.startsWith(`${RELEASES_PAGE_URL}/`)
    ? raw.slice(0, 256)
    : RELEASES_PAGE_URL
}

/**
 * Chọn bản phát hành mới nhất của một loại từ phản hồi `GET /repos/.../releases`.
 * Bỏ bản nháp, bản thử (prerelease) và tag không đúng tiền tố hoặc không phải `x.y.z`.
 * Trả null khi chưa có release loại đó (hoặc dữ liệu không đọc được); khi có thì `available` cho biết
 * có mới hơn `current` không. `current` không phải số phiên bản phát hành (bản dev) thì `available` luôn false.
 */
export function latestRelease(
  list: unknown,
  kind: ReleaseKind,
  current: string,
): UpdateInfo | null {
  if (!Array.isArray(list)) return null
  const prefix = RELEASE_TAG_PREFIX[kind]
  let best: { version: string; url: string } | null = null
  for (const r of list as Array<Record<string, unknown>>) {
    if (!r || typeof r !== 'object' || r.draft === true || r.prerelease === true) continue
    const tag = r.tag_name
    if (typeof tag !== 'string' || !tag.startsWith(prefix)) continue
    const version = tag.slice(prefix.length)
    if (!isReleaseVersion(version)) continue
    if (!best || compareVersions(version, best.version) > 0) {
      best = { version, url: safeReleaseUrl(r.html_url) }
    }
  }
  if (!best) return null
  return {
    latest: best.version,
    url: best.url,
    available: isReleaseVersion(current) && compareVersions(best.version, current) > 0,
  }
}

// ---------------------------------------------------------------------------
// Server ép Gateway đồng bộ bản mới (tự cập nhật Gateway)
// ---------------------------------------------------------------------------

/** Tên file exe Gateway đính kèm release `gateway-v<x.y.z>` (cùng bộ cài), và file băm đi kèm. */
export const GATEWAY_EXE_ASSET = 'az-gateway.exe'
export const SHA256SUMS_ASSET = 'SHA256SUMS.txt'

/**
 * Địa chỉ tải exe Gateway của một phiên bản: LUÔN dựng từ repo + tag, không lấy từ dữ liệu ngoài. Gateway chỉ
 * chấp nhận đúng địa chỉ này khi Server báo `update`, nên Server (hoặc hub) bị chiếm cũng không dẫn Gateway tới host lạ.
 */
export function gatewayAssetUrl(version: string): string {
  return `${RELEASES_PAGE_URL}/download/${RELEASE_TAG_PREFIX.gateway}${version}/${GATEWAY_EXE_ASSET}`
}

export function sha256SumsUrl(version: string): string {
  return `${RELEASES_PAGE_URL}/download/${RELEASE_TAG_PREFIX.gateway}${version}/${SHA256SUMS_ASSET}`
}

/** Bản Gateway mà Server đề nghị mọi Gateway đang nối cập nhật tới (kèm băm SHA-256 của exe). */
export type GatewayOffer = { version: string; url: string; sha256: string }

const SHA256_HEX = /^[0-9a-f]{64}$/

/** Đọc `SHA256SUMS.txt` (mỗi dòng `<băm>  <tên file>` hoặc `<băm> *<tên file>`), trả băm của `file` hoặc null. */
export function parseSha256Sums(text: string, file: string): string | null {
  for (const raw of text.split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(raw.trim())
    if (!m) continue
    if (m[2] === file) {
      const hash = (m[1] ?? '').toLowerCase()
      return SHA256_HEX.test(hash) ? hash : null
    }
  }
  return null
}

/**
 * Phiên bản Gateway mới nhất CÓ ĐỦ file để tự cập nhật (exe và file băm đều đã đính kèm release). Release cũ chỉ có bộ cài
 * (trước khi có tính năng này) bị bỏ qua. Bỏ bản nháp, bản thử và tag sai dạng, giống `latestRelease`.
 */
export function latestGatewayRelease(list: unknown): string | null {
  if (!Array.isArray(list)) return null
  const prefix = RELEASE_TAG_PREFIX.gateway
  let best: string | null = null
  for (const r of list as Array<Record<string, unknown>>) {
    if (!r || typeof r !== 'object' || r.draft === true || r.prerelease === true) continue
    const tag = r.tag_name
    if (typeof tag !== 'string' || !tag.startsWith(prefix)) continue
    const version = tag.slice(prefix.length)
    if (!isReleaseVersion(version)) continue
    const names = new Set(
      Array.isArray(r.assets)
        ? (r.assets as Array<Record<string, unknown>>).map((a) => (a ? a.name : undefined))
        : [],
    )
    if (!names.has(GATEWAY_EXE_ASSET) || !names.has(SHA256SUMS_ASSET)) continue
    if (best === null || compareVersions(version, best) > 0) best = version
  }
  return best
}
