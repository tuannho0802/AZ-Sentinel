import { DEVICE_HANDOFF_TTL_SEC, isRawDeviceId } from '@az-sentinel/shared'

/**
 * Vé trao mã thiết bị (Plan 3K): mã thô của thiết bị được mã hóa AES-GCM (khóa dẫn xuất từ `SYNC_TOKEN`, bí mật
 * chung của Worker và Server) cùng hạn dùng. Mã hóa chứ không chỉ ký để mã thô không lộ trong URL/lịch sử trình
 * duyệt; GCM tự xác thực nên vé bị sửa hay ký bằng khóa khác đều bị từ chối. Định dạng: `v1.<base64url(iv ‖ bản mã)>`.
 */
const VERSION = 'v1'
const AAD = new TextEncoder().encode('az-device-handoff-v1')
const IV_LEN = 12

const toB64 = (b: Uint8Array): string => {
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const fromB64 = (s: string): Uint8Array | null => {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
    return Uint8Array.from(bin, (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}

async function handoffKey(secret: string, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  const material = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`az-device-handoff:${secret}`),
  )
  return crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, [usage])
}

/** Tạo vé cho mã thiết bị thô `raw`, hết hạn sau `DEVICE_HANDOFF_TTL_SEC` giây. */
export async function sealDeviceHandoff(
  secret: string,
  raw: string,
  nowSec: number,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN))
  const plain = new TextEncoder().encode(
    JSON.stringify({ r: raw, e: nowSec + DEVICE_HANDOFF_TTL_SEC }),
  )
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: AAD },
      await handoffKey(secret, 'encrypt'),
      plain,
    ),
  )
  const out = new Uint8Array(iv.length + ct.length)
  out.set(iv)
  out.set(ct, iv.length)
  return `${VERSION}.${toB64(out)}`
}

export type OpenedHandoff = {
  /** Mã thiết bị thô. */
  raw: string
  /** Mã dùng một lần của vé (chính là IV): Server nhớ để vé không dùng lại được. */
  nonce: string
  /** Mốc hết hạn (giây). */
  expSec: number
}

/** Giải vé; trả null nếu sai định dạng, sai khóa, bị sửa, hết hạn (hoặc hạn quá xa) hay mã thô không hợp lệ. */
export async function openDeviceHandoff(
  secret: string,
  token: string,
  nowSec: number,
): Promise<OpenedHandoff | null> {
  if (secret === '' || token.length > 512) return null
  const [ver, body, extra] = token.split('.')
  if (ver !== VERSION || body === undefined || extra !== undefined) return null
  const bytes = fromB64(body)
  if (!bytes || bytes.length <= IV_LEN + 16) return null
  const iv = bytes.slice(0, IV_LEN)
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: AAD },
      await handoffKey(secret, 'decrypt'),
      bytes.slice(IV_LEN),
    )
    const data = JSON.parse(new TextDecoder().decode(plain)) as { r?: unknown; e?: unknown }
    if (!isRawDeviceId(data.r) || typeof data.e !== 'number' || !Number.isFinite(data.e))
      return null
    if (data.e < nowSec || data.e > nowSec + DEVICE_HANDOFF_TTL_SEC + 5) return null
    return { raw: data.r, nonce: toB64(iv), expSec: data.e }
  } catch {
    return null
  }
}
