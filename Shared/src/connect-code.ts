import { looksLikeGwToken } from './token-schema'

/**
 * Mã kết nối Gateway: MỘT chuỗi gói sẵn địa chỉ VPS chính, địa chỉ dự phòng và token cá nhân, để người
 * dùng cuối chỉ dán một lần thay vì gõ tay URL và token. Dạng: `azc1.<base64url(JSON)>`.
 * Mã có chứa token nên bí mật như token: chỉ hiện lúc quản trị viên cấp hoặc đặt lại token.
 */
export const CONNECT_CODE_PREFIX = 'azc1.'
/** Đường WebSocket của Gateway trên máy chủ (khớp BE `/api/gw/ws`). */
export const GW_WS_PATH = '/api/gw/ws'

export type ConnectPayload = {
  /** URL WebSocket VPS chính, dạng `wss://host/api/gw/ws`. */
  primaryUrl: string
  /** URL WebSocket dự phòng (Cloudflare); bỏ trống nếu không có. */
  fallbackUrl: string
  token: string
}

const WS_URL = /^wss?:\/\/[^\s"\\]+$/i

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): string | null {
  try {
    const std = text.replace(/-/g, '+').replace(/_/g, '/')
    const bin = atob(std + '='.repeat((4 - (std.length % 4)) % 4))
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
  } catch {
    return null
  }
}

/** Mã hóa; trả null nếu dữ liệu không hợp lệ (URL không phải ws/wss, token sai hình dạng). */
export function encodeConnectCode(p: ConnectPayload): string | null {
  if (!WS_URL.test(p.primaryUrl)) return null
  if (p.fallbackUrl !== '' && !WS_URL.test(p.fallbackUrl)) return null
  if (!looksLikeGwToken(p.token)) return null
  const json = JSON.stringify({ v: 1, u: p.primaryUrl, f: p.fallbackUrl, t: p.token })
  return CONNECT_CODE_PREFIX + toBase64Url(json)
}

/** Giải mã; chịu được khoảng trắng và dấu ngoặc kép dán thừa. Trả null nếu mã sai. */
export function decodeConnectCode(raw: string): ConnectPayload | null {
  const code = raw.trim().replace(/^["']+|["']+$/g, '')
  if (!code.startsWith(CONNECT_CODE_PREFIX)) return null
  const json = fromBase64Url(code.slice(CONNECT_CODE_PREFIX.length))
  if (json === null) return null
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  const d = data as Record<string, unknown>
  if (d.v !== 1 || typeof d.u !== 'string' || typeof d.t !== 'string') return null
  const f = typeof d.f === 'string' ? d.f : ''
  if (!WS_URL.test(d.u) || (f !== '' && !WS_URL.test(f)) || !looksLikeGwToken(d.t)) return null
  return { primaryUrl: d.u, fallbackUrl: f, token: d.t }
}

/** `https://host[:port][/...]` thành `wss://host[:port]/api/gw/ws` (http thành ws). Null nếu sai. */
export function httpToGatewayWsUrl(httpUrl: string): string | null {
  let u: URL
  try {
    u = new URL(httpUrl.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  return `${u.protocol === 'https:' ? 'wss:' : 'ws:'}//${u.host}${GW_WS_PATH}`
}

/** Máy chủ chỉ truy cập được từ chính nó (localhost, 127.x, ::1): đưa vào mã cho người khác là vô dụng. */
export function isLocalOnlyHost(host: string): boolean {
  const h = host
    .toLowerCase()
    .replace(/:\d+$/, '')
    .replace(/^\[|\]$/g, '')
  return h === 'localhost' || h === '::1' || h.startsWith('127.') || h === '0.0.0.0'
}
