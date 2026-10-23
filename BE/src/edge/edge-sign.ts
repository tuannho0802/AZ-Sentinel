import { EDGE_IP_HEADER, EDGE_SIG_HEADER, EDGE_TS_HEADER, edgeMessage } from '@az-sentinel/shared'

const encoder = new TextEncoder()

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Đặt IP thật của người dùng và chữ ký lên header gửi sang VPS (Plan 3G). Luôn xóa trước các header này trong
 * request gốc để client không tự đặt được. Không có `secret` hoặc không biết IP thì chỉ xóa, không ký.
 */
export async function applyEdgeClientIp(
  headers: Headers,
  ip: string | null,
  secret: string | undefined,
  nowSec: number,
): Promise<void> {
  headers.delete(EDGE_IP_HEADER)
  headers.delete(EDGE_TS_HEADER)
  headers.delete(EDGE_SIG_HEADER)
  if (!ip) return
  // Giữ header cũ cho VPS đời trước (chỉ để đọc); VPS mới chỉ tin khi có chữ ký.
  headers.set(EDGE_IP_HEADER, ip)
  if (!secret) return
  headers.set(EDGE_TS_HEADER, String(nowSec))
  headers.set(EDGE_SIG_HEADER, await hmacHex(secret, edgeMessage(ip, nowSec)))
}
