import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import { sha256Hex } from '../../src/lib/crypto'
import {
  createToken,
  ensureDevToken,
  findActiveTokenByHash,
  getTokenById,
  listTokens,
  resetToken,
  revokeToken,
  TOKEN_TOUCH_SEC,
  toSummary,
  touchTokenUsed,
} from '../../src/services/gw-token-service'
import { resetDb } from '../helpers'

const db = env.DB

beforeEach(resetDb)

describe('gw-token-service', () => {
  it('cấp: token thô khớp băm lưu, không lưu token thô', async () => {
    const { token, row } = await createToken(db, { ownerId: 1, label: 'A' }, 100)
    expect(token).toMatch(/^azt_[A-Za-z0-9_-]{32}$/)
    expect(row.token_hash).toBe(await sha256Hex(token))
    expect(row.token_prefix).toBe(token.slice(0, 12))
    expect(JSON.stringify(row)).not.toContain(token)
    expect(toSummary(row)).not.toHaveProperty('token_hash')
  })

  it('mỗi người một token đang hoạt động; người khác cấp riêng được', async () => {
    await createToken(db, { ownerId: 1, label: 'A' }, 100)
    await expect(createToken(db, { ownerId: 1, label: 'A2' }, 101)).rejects.toMatchObject({
      status: 409,
    })
    await expect(createToken(db, { ownerId: 2, label: 'B' }, 102)).resolves.toBeTruthy()
    expect(await listTokens(db)).toHaveLength(2)
  })

  it('đặt lại: token cũ chết ngay, cùng id, last_used_at về null', async () => {
    const { token, row } = await createToken(db, { ownerId: 1, label: 'A' }, 100)
    await touchTokenUsed(db, row, 150)
    const out = await resetToken(db, row.id)
    expect(out?.row.id).toBe(row.id)
    expect(out?.token).not.toBe(token)
    expect(out?.row.last_used_at).toBeNull()
    expect(await findActiveTokenByHash(db, await sha256Hex(token))).toBeNull()
    expect(await findActiveTokenByHash(db, await sha256Hex(out?.token ?? ''))).not.toBeNull()
  })

  it('đặt lại: không có dòng thì null, đã thu hồi thì 409', async () => {
    expect(await resetToken(db, 9999)).toBeNull()
    const { row } = await createToken(db, { ownerId: 1, label: 'A' }, 100)
    await revokeToken(db, row.id, 200)
    await expect(resetToken(db, row.id)).rejects.toMatchObject({ status: 409 })
  })

  it('thu hồi: token không còn tra được, gọi lại vẫn giữ revoked_at đầu tiên, cấp mới được', async () => {
    const { token, row } = await createToken(db, { ownerId: 1, label: 'A' }, 100)
    const first = await revokeToken(db, row.id, 200)
    expect(first).toMatchObject({ status: 'revoked', revoked_at: 200 })
    expect(await revokeToken(db, row.id, 300)).toMatchObject({ revoked_at: 200 })
    expect(await findActiveTokenByHash(db, await sha256Hex(token))).toBeNull()
    expect(await revokeToken(db, 9999, 1)).toBeNull()
    await expect(createToken(db, { ownerId: 1, label: 'A' }, 400)).resolves.toBeTruthy()
  })

  it('touchTokenUsed chỉ ghi tối đa mỗi giờ một lần', async () => {
    const { row } = await createToken(db, { ownerId: 1, label: 'A' }, 100)
    await touchTokenUsed(db, row, 1000)
    const used = await getTokenById(db, row.id)
    expect(used?.last_used_at).toBe(1000)
    if (!used) throw new Error('mất dòng')
    await touchTokenUsed(db, used, 1000 + TOKEN_TOUCH_SEC - 1)
    expect((await getTokenById(db, row.id))?.last_used_at).toBe(1000)
    await touchTokenUsed(db, used, 1000 + TOKEN_TOUCH_SEC)
    expect((await getTokenById(db, row.id))?.last_used_at).toBe(1000 + TOKEN_TOUCH_SEC)
  })

  it('ensureDevToken: tạo, giữ khi chạy lại, thay token dev cũ của cùng người', async () => {
    const dev = 'azt_dev0123456789abcdef0123456789ab'
    await ensureDevToken(db, dev, 1, 'Dev', 10)
    await ensureDevToken(db, dev, 1, 'Dev', 20)
    expect(await listTokens(db)).toHaveLength(1)
    const other = 'azt_dev-khac-0123456789abcdef012345'
    await ensureDevToken(db, other, 1, 'Dev', 30)
    expect(await listTokens(db)).toHaveLength(1)
    expect(await findActiveTokenByHash(db, await sha256Hex(dev))).toBeNull()
    expect(await findActiveTokenByHash(db, await sha256Hex(other))).not.toBeNull()
  })
})
