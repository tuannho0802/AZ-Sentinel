import { describe, expect, it } from 'vitest'
import { generateApiKey, sha256Hex } from '../../src/lib/crypto'

describe('sha256Hex', () => {
  it('khớp vector chuẩn của SHA-256("abc")', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})

describe('generateApiKey', () => {
  it('tạo khóa base64url 43 ký tự (32 byte), băm hex 64 ký tự, tiền tố 8 ký tự', async () => {
    const { key, keyHash, keyPrefix } = await generateApiKey()
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(keyHash).toMatch(/^[0-9a-f]{64}$/)
    expect(keyPrefix).toBe(key.slice(0, 8))
    expect(await sha256Hex(key)).toBe(keyHash)
  })

  it('không trùng nhau giữa các lần tạo', async () => {
    const keys = await Promise.all(Array.from({ length: 20 }, () => generateApiKey()))
    expect(new Set(keys.map((k) => k.key)).size).toBe(20)
  })

  it('băm không chứa khóa thô', async () => {
    const { key, keyHash } = await generateApiKey()
    expect(keyHash.includes(key)).toBe(false)
  })
})
