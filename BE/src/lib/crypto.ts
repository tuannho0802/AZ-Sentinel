const encoder = new TextEncoder()

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** SHA-256 dạng hex thường (64 ký tự), dùng WebCrypto. */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input))
  return toHex(new Uint8Array(digest))
}

export const API_KEY_PREFIX_LENGTH = 8

export type GeneratedApiKey = {
  /** Khóa đầy đủ: chỉ hiện một lần cho người dùng, không lưu. */
  key: string
  keyHash: string
  keyPrefix: string
}

/** 32 byte ngẫu nhiên (crypto.getRandomValues), mã hóa base64url (Rules BE mục 5). */
export async function generateApiKey(): Promise<GeneratedApiKey> {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  const key = toBase64Url(bytes)
  return { key, keyHash: await sha256Hex(key), keyPrefix: key.slice(0, API_KEY_PREFIX_LENGTH) }
}
