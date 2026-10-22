import { fromBase64Url, timingSafeEqual, toBase64Url } from './crypto'

/**
 * Băm mật khẩu bằng PBKDF2-SHA256 (WebCrypto, chạy được trên cả Worker lẫn Node). Cloudflare Workers
 * chỉ cho tối đa 100.000 vòng lặp nên đây cũng là mức dùng; muối ngẫu nhiên 16 byte cho mỗi mật khẩu.
 */
const ALGO = 'pbkdf2-sha256'
export const PASSWORD_ITERATIONS = 100_000
const SALT_BYTES = 16
const KEY_BITS = 256

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    KEY_BITS,
  )
  return new Uint8Array(bits)
}

export async function hashPassword(
  password: string,
  iterations = PASSWORD_ITERATIONS,
): Promise<string> {
  const salt = new Uint8Array(SALT_BYTES)
  crypto.getRandomValues(salt)
  const hash = await derive(password, salt, iterations)
  return `${ALGO}$${iterations}$${toBase64Url(salt)}$${toBase64Url(hash)}`
}

/** Kiểm mật khẩu với chuỗi băm đã lưu. Chuỗi lưu hỏng hoặc lạ thì trả false (không ném lỗi). */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, iterRaw, saltRaw, hashRaw] = stored.split('$')
  const iterations = Number(iterRaw)
  if (algo !== ALGO || !Number.isInteger(iterations) || iterations < 1 || iterations > 1_000_000) {
    return false
  }
  const salt = saltRaw ? fromBase64Url(saltRaw) : null
  const expected = hashRaw ? fromBase64Url(hashRaw) : null
  if (!salt || !expected) return false
  return timingSafeEqual(await derive(password, salt, iterations), expected)
}
