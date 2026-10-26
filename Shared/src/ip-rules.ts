import { z } from 'zod'

/**
 * Whitelist IP (Plan 3F). Quản trị viên khai báo IP (hoặc dải CIDR IPv4) được phép nối vào máy chủ VPS và
 * số kết nối WebSocket (Gateway + trang live) tối đa của mỗi IP. Dùng chung cho BE (kiểm tra đầu vào) và
 * Server (thực thi) để hai phía hiểu một IP giống hệt nhau.
 */

export const IP_RULE_DEFAULT_MAX_CONNS = 5
export const IP_RULE_MAX_CONNS_LIMIT = 100

/** Bỏ khoảng trắng, hạ chữ thường, bỏ tiền tố IPv4-mapped (`::ffff:1.2.3.4` -> `1.2.3.4`). */
export function normalizeIp(raw: string): string {
  const text = raw.trim().toLowerCase()
  return text.startsWith('::ffff:') && text.includes('.') ? text.slice(7) : text
}

function parseV4(text: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text)
  if (!m) return null
  let n = 0
  for (let i = 1; i <= 4; i++) {
    const part = Number(m[i])
    if (part > 255) return null
    n = n * 256 + part
  }
  return n
}

export type IpPattern =
  | { kind: 'v4'; base: number; bits: number; text: string }
  | { kind: 'v6'; text: string }

/**
 * Hiểu một mẫu IP: IPv4 (`1.2.3.4`), dải IPv4 (`1.2.3.0/24`) hoặc IPv6 đầy đủ để so khớp đúng từng chữ.
 * Sai định dạng trả null. Dải được chuẩn hóa về địa chỉ đầu dải để hai cách viết cùng dải trùng nhau.
 */
export function parseIpPattern(raw: string): IpPattern | null {
  const text = normalizeIp(raw)
  if (text === '' || text.length > 64) return null
  const slash = text.indexOf('/')
  if (slash === -1) {
    const v4 = parseV4(text)
    if (v4 !== null) return { kind: 'v4', base: v4, bits: 32, text }
    return /^[0-9a-f:]+$/.test(text) && text.includes(':') && text.length >= 2
      ? { kind: 'v6', text }
      : null
  }
  const v4 = parseV4(text.slice(0, slash))
  const bitsText = text.slice(slash + 1)
  if (v4 === null || !/^\d{1,2}$/.test(bitsText)) return null
  const bits = Number(bitsText)
  if (bits < 0 || bits > 32) return null
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  const base = (v4 & mask) >>> 0
  const octets = [base >>> 24, (base >>> 16) & 255, (base >>> 8) & 255, base & 255]
  return {
    kind: 'v4',
    base,
    bits,
    text: bits === 32 ? octets.join('.') : `${octets.join('.')}/${bits}`,
  }
}

/** `ip` có nằm trong mẫu không. IP sai định dạng thì không khớp mẫu nào. */
export function ipMatches(pattern: IpPattern, rawIp: string): boolean {
  const ip = normalizeIp(rawIp)
  if (pattern.kind === 'v6') return ip === pattern.text
  const v4 = parseV4(ip)
  if (v4 === null) return false
  if (pattern.bits === 0) return true
  const mask = (0xffffffff << (32 - pattern.bits)) >>> 0
  return (v4 & mask) >>> 0 === pattern.base
}

export function isLoopbackIp(rawIp: string): boolean {
  const ip = normalizeIp(rawIp)
  return ip === '::1' || ip === 'localhost' || ip.startsWith('127.')
}

const ipText = z
  .string()
  .trim()
  .max(64)
  .refine((v) => parseIpPattern(v) !== null, 'IP hoặc dải CIDR không hợp lệ')
  .transform((v) => parseIpPattern(v)?.text ?? v)

const maxConns = z.number().int().min(1).max(IP_RULE_MAX_CONNS_LIMIT)

export const createIpRuleRequestSchema = z.object({
  ip: ipText,
  label: z.string().trim().max(64).default(''),
  max_conns: maxConns.default(IP_RULE_DEFAULT_MAX_CONNS),
})
export type CreateIpRuleRequest = z.infer<typeof createIpRuleRequestSchema>

export const updateIpRuleRequestSchema = z
  .object({ label: z.string().trim().max(64).optional(), max_conns: maxConns.optional() })
  .refine((v) => v.label !== undefined || v.max_conns !== undefined, 'Không có gì để sửa')
export type UpdateIpRuleRequest = z.infer<typeof updateIpRuleRequestSchema>

export const setIpGuardRequestSchema = z.object({ enforce: z.boolean() })

export type IpRule = {
  id: number
  ip: string
  label: string
  max_conns: number
  created_at: number
  /** Có giá trị khi IP do một thiết bị `any_ip` tự thêm (xem whitelist thiết bị). */
  device_id?: string | null
}

export type IpBlocked = {
  ip: string
  last_at: number
  count: number
  /** Thiết bị đã gửi request bị chặn (nếu nhận diện được) và nhãn nếu thiết bị đã được duyệt. */
  device_id?: string | null
  device_label?: string | null
}

export type IpGuardState = {
  /** Bật = chỉ IP trong danh sách (và máy chạy Server) mới vào được. Tắt = ai cũng vào được như trước. */
  enforce: boolean
  /** IP mà Server thấy ở request này (null khi gọi thẳng từ máy chạy Server hoặc Cloudflare không có IP). */
  your_ip: string | null
  your_ip_allowed: boolean
  rules: IpRule[]
  /** IP bị chặn gần đây (mới nhất trước) để quản trị viên cho phép bằng một cú bấm. */
  blocked: IpBlocked[]
}
