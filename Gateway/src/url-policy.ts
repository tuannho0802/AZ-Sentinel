/**
 * Chính sách địa chỉ cloud của Gateway. Gateway gửi token cá nhân (`Authorization: Bearer`) tới mọi địa chỉ nó nối,
 * nên địa chỉ phải (1) mã hóa (`wss://`), trừ mạng nội bộ/loopback dùng khi thử, và (2) với địa chỉ học từ danh bạ
 * tunnel, phải thuộc nơi đáng tin: danh bạ bị chiếm cũng không được dẫn token tới máy chủ lạ.
 */

const trimBrackets = (host: string) => host.replace(/^\[|\]$/g, '').toLowerCase()

/** Loopback hoặc mạng nội bộ (RFC 1918, link-local, ULA IPv6): ở đó `ws://` chấp nhận được. */
export function isPrivateOrLoopbackHost(rawHost: string): boolean {
  const h = trimBrackets(rawHost)
  if (h === 'localhost' || h.endsWith('.localhost') || h === '::1') return true
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])]
    return (
      a === 127 ||
      a === 10 ||
      (a === 192 && b === 168) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 169 && b === 254)
    )
  }
  return /^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h)
}

/** Địa chỉ cloud cấu hình được phép: `wss://` mọi nơi; `ws://` chỉ loopback/mạng nội bộ. Rỗng coi là hợp lệ (chưa cấu hình). */
export function isAllowedCloudUrl(raw: string): boolean {
  if (raw.trim() === '') return true
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return false
  }
  if (u.protocol === 'wss:') return true
  return u.protocol === 'ws:' && isPrivateOrLoopbackHost(u.hostname)
}

/** Tên miền Quick Tunnel của Cloudflare. */
const TUNNEL_SUFFIX = '.trycloudflare.com'

/**
 * Địa chỉ WebSocket học từ danh bạ có được nối (và gửi token tới) không: `wss://` tới Quick Tunnel
 * (`*.trycloudflare.com`) hoặc tới đúng máy chủ đã nằm trong cấu hình (`known`); `ws://` chỉ loopback (thử nghiệm).
 */
export function isTrustedLearnedUrl(raw: string, known: readonly string[]): boolean {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.username !== '' || u.password !== '') return false
  const host = u.hostname.toLowerCase()
  if (u.protocol === 'ws:') return host === '127.0.0.1' || host === 'localhost'
  if (u.protocol !== 'wss:') return false
  if (host.endsWith(TUNNEL_SUFFIX) && host.length > TUNNEL_SUFFIX.length) return true
  return known.some((k) => {
    try {
      return new URL(k).hostname.toLowerCase() === host
    } catch {
      return false
    }
  })
}

/** Bỏ ký tự điều khiển (xuống dòng, ESC...) khỏi chuỗi do máy chủ gửi trước khi ghi log (chống chèn dòng log giả). */
export function sanitizeForLog(text: string, max = 240): string {
  let out = ''
  let gap = false
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) {
      gap = out !== ''
      continue
    }
    if (gap) out += ' '
    gap = false
    out += ch
  }
  return out.slice(0, max)
}
