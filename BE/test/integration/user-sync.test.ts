import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import { hashPassword } from '../../src/lib/password'
import { applySync } from '../../src/services/sync-service'
import { findUserByEmail } from '../../src/services/user-service'
import { resetDb } from '../helpers'

beforeEach(resetDb)

const empty = {
  users: [],
  tokens: [],
  links: [],
  links_deleted: [],
  trades: [],
  trades_deleted: [],
  alert_settings: [],
  alert_states: [],
  notifications: [],
}

describe('đồng bộ người dùng VPS -> Cloudflare', () => {
  it('đẩy người dùng sang: đăng nhập được bằng băm đã đồng bộ, đẩy lại không lỗi, đổi trạng thái xóa phiên', async () => {
    const hash = await hashPassword('mat-khau-dai-123', 1000)
    const row = {
      id: 7,
      email: 'an@az.test',
      display_name: 'An',
      password_hash: hash,
      role: 'user' as const,
      status: 'active' as const,
      created_at: 100,
    }
    expect(await applySync(env.DB, { ...empty, users: [row] })).toBe(1)
    expect(await applySync(env.DB, { ...empty, users: [row] })).toBe(1)
    expect(await findUserByEmail(env.DB, 'an@az.test')).toMatchObject({
      id: 7,
      password_hash: hash,
    })

    await env.DB.prepare(
      'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    )
      .bind('h'.repeat(64), 7, 1, 9_999_999_999)
      .run()
    await applySync(env.DB, { ...empty, users: [{ ...row, status: 'suspended' as const }] })
    const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first<{ n: number }>()
    expect(left?.n).toBe(0)
  })

  it('không ghi đè bộ đếm đăng nhập sai của Cloudflare và nhường email cho dòng mới', async () => {
    const hash = await hashPassword('mat-khau-dai-123', 1000)
    const base = {
      display_name: 'A',
      password_hash: hash,
      role: 'user' as const,
      status: 'active' as const,
      created_at: 1,
    }
    await applySync(env.DB, { ...empty, users: [{ ...base, id: 1, email: 'a@az.test' }] })
    await env.DB.prepare('UPDATE users SET failed_logins = 3 WHERE id = 1').run()
    await applySync(env.DB, {
      ...empty,
      users: [{ ...base, id: 1, email: 'a@az.test', display_name: 'B' }],
    })
    const u = await findUserByEmail(env.DB, 'a@az.test')
    expect(u).toMatchObject({ display_name: 'B', failed_logins: 3 })

    await applySync(env.DB, { ...empty, users: [{ ...base, id: 2, email: 'a@az.test' }] })
    expect(await findUserByEmail(env.DB, 'a@az.test')).toMatchObject({ id: 2 })
  })
})
