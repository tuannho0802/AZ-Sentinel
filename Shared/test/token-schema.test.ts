import { describe, expect, it } from 'vitest'
import {
  createGwTokenRequestSchema,
  GW_TOKEN_LENGTH,
  looksLikeGwToken,
  syncApplySchema,
  syncTokenRowSchema,
} from '../src'

const row = {
  id: 1,
  owner_id: 7,
  label: 'An',
  token_hash: 'a'.repeat(64),
  token_prefix: 'azt_AbCd1234',
  status: 'active',
  created_at: 100,
  revoked_at: null,
}

describe('looksLikeGwToken', () => {
  it('chấp nhận token đúng hình dạng', () => {
    expect(looksLikeGwToken(`azt_${'A'.repeat(GW_TOKEN_LENGTH - 4)}`)).toBe(true)
    expect(looksLikeGwToken('azt_dev0123456789abcdef0123456789ab')).toBe(true)
  })

  it.each([
    '',
    'azt_',
    'azt_ngan',
    `xyz_${'A'.repeat(32)}`,
    `azt_${'A'.repeat(200)}`,
    `azt_${'A'.repeat(31)} `,
    `azt_${'A'.repeat(31)}!`,
  ])('từ chối %j', (v) => {
    expect(looksLikeGwToken(v)).toBe(false)
  })
})

describe('createGwTokenRequestSchema', () => {
  it('nhận owner_id nguyên dương và nhãn đã cắt khoảng trắng', () => {
    expect(createGwTokenRequestSchema.parse({ owner_id: 3, label: '  An  ' })).toEqual({
      owner_id: 3,
      label: 'An',
    })
  })

  it.each([
    { owner_id: 0, label: 'x' },
    { owner_id: -1, label: 'x' },
    { owner_id: 1.5, label: 'x' },
    { owner_id: '3', label: 'x' },
    { owner_id: 3, label: '   ' },
    { owner_id: 3, label: 'x'.repeat(65) },
  ])('từ chối %j', (body) => {
    expect(createGwTokenRequestSchema.safeParse(body).success).toBe(false)
  })
})

describe('syncTokenRowSchema / syncApplySchema', () => {
  it('chấp nhận dòng hợp lệ; `tokens` mặc định rỗng (tương thích bản cũ)', () => {
    expect(syncTokenRowSchema.safeParse(row).success).toBe(true)
    expect(syncApplySchema.parse({}).tokens).toEqual([])
  })

  it.each([
    { token_hash: 'ngan' },
    { token_hash: 'G'.repeat(64) },
    { status: 'khac' },
    { owner_id: 0 },
  ])('từ chối dòng sai %j', (over) => {
    expect(syncTokenRowSchema.safeParse({ ...row, ...over }).success).toBe(false)
  })

  it('không nhận last_used_at (mỗi nơi tự ghi)', () => {
    const parsed = syncTokenRowSchema.parse({ ...row, last_used_at: 5 })
    expect(parsed).not.toHaveProperty('last_used_at')
  })
})
