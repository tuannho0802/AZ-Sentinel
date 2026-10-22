import { looksLikeGwToken } from '@az-sentinel/shared'

/**
 * Kiểm token Gateway cá nhân (`azt_...`) với cloud, dùng cho bộ cài: `az-gateway.exe check-token <url> <token>`.
 * Gọi `GET /api/gw/check` (200 hợp lệ, 401 sai/đã thu hồi). Không in token ra output.
 *
 * Mã thoát (bộ cài dựa vào đây, đừng đổi số):
 *   0 = token hợp lệ
 *   1 = cloud từ chối token (sai, đã thu hồi hoặc đã đặt lại)
 *   2 = không hỏi được cloud (mạng, địa chỉ sai, cloud lỗi): chưa kết luận được về token
 *   3 = đầu vào sai (thiếu tham số, URL không phải ws/wss/http/https, token sai hình dạng)
 */
export const CHECK_OK = 0
export const CHECK_INVALID = 1
export const CHECK_UNREACHABLE = 2
export const CHECK_BAD_INPUT = 3

export type CheckResult = { code: number; message: string }

/** `wss://host/api/gw/ws` (hoặc `https://host`) thành `https://host/api/gw/check`. Null nếu URL sai. */
export function cloudCheckUrl(cloudUrl: string): string | null {
  let u: URL
  try {
    u = new URL(cloudUrl.trim())
  } catch {
    return null
  }
  const proto =
    u.protocol === 'wss:' || u.protocol === 'https:'
      ? 'https:'
      : u.protocol === 'ws:' || u.protocol === 'http:'
        ? 'http:'
        : null
  if (!proto) return null
  return `${proto}//${u.host}/api/gw/check`
}

export async function checkGatewayToken(
  cloudUrl: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CheckResult> {
  const url = cloudCheckUrl(cloudUrl)
  if (!url)
    return { code: CHECK_BAD_INPUT, message: 'Cloud URL phải bắt đầu bằng wss:// hoặc ws://' }
  const t = token.trim()
  if (!looksLikeGwToken(t)) {
    return { code: CHECK_BAD_INPUT, message: 'Token phải là token cá nhân dạng azt_...' }
  }
  try {
    const res = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${t}`, 'user-agent': 'az-gateway-installer' },
      signal: AbortSignal.timeout(8000),
    })
    if (res.status === 200) return { code: CHECK_OK, message: 'Token hợp lệ' }
    if (res.status === 401) {
      return {
        code: CHECK_INVALID,
        message: 'Token bị từ chối: sai, đã thu hồi hoặc đã đặt lại. Xin quản trị viên token mới',
      }
    }
    return { code: CHECK_UNREACHABLE, message: `Cloud trả mã ${res.status}, chưa kiểm được token` }
  } catch {
    return { code: CHECK_UNREACHABLE, message: 'Không nối được cloud (mạng hoặc địa chỉ sai)' }
  }
}

/** Điểm vào dòng lệnh: `args` là phần sau `check-token`. In đúng một dòng ra `out`, trả mã thoát. */
export async function runCheckToken(
  args: string[],
  out: (line: string) => void = console.log,
  fetchImpl: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const url = args[0] ?? env.AZ_GW_CLOUD_URL ?? ''
  const token = args[1] ?? env.AZ_GW_TOKEN ?? ''
  const r = await checkGatewayToken(url, token, fetchImpl)
  out(r.message)
  return r.code
}
