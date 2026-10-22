import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { verifyPassword } from '../../BE/src/lib/password'
import { findUserByEmail, listUsers } from '../../BE/src/services/user-service'
import type { ServerConfig } from '../src/config'
import { openDatabase } from '../src/shim/d1'
import { runUserCli, type SecretReader } from '../src/user-cli'

const migrations = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../BE/migrations')
let dir: string
let cfg: ServerConfig

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'az-user-cli-'))
  cfg = { dbFile: path.join(dir, 'db.sqlite'), migrationsDir: migrations } as ServerConfig
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

const typing =
  (...answers: string[]): SecretReader =>
  async () =>
    answers.shift() ?? ''

async function inDb<T>(fn: (db: D1Database) => Promise<T>): Promise<T> {
  const sqlite = openDatabase(cfg.dbFile)
  try {
    return await fn(sqlite as unknown as D1Database)
  } finally {
    sqlite.sqlite.close()
  }
}

const PW = 'mat-khau-dai-123'

describe('server.mjs user (VPS)', () => {
  it('create-admin tạo quản trị viên gốc đăng nhập được bằng mật khẩu đã nhập', async () => {
    const code = await runUserCli(
      cfg,
      ['create-admin', 'Chu@AZ.test', 'Chủ', 'VPS'],
      typing(PW, PW),
    )
    expect(code).toBe(0)
    const user = await inDb((db) => findUserByEmail(db, 'chu@az.test'))
    expect(user).toMatchObject({ role: 'root_admin', status: 'active', display_name: 'Chủ VPS' })
    expect(await verifyPassword(PW, user?.password_hash ?? '')).toBe(true)
  })

  it('từ chối mật khẩu ngắn, hai lần không khớp, email trùng và thiếu tham số', async () => {
    expect(await runUserCli(cfg, ['create-admin', 'a@az.test', 'A'], typing('ngan'))).toBe(1)
    expect(
      await runUserCli(cfg, ['create-admin', 'a@az.test', 'A'], typing(PW, 'khac-mat-khau-123')),
    ).toBe(1)
    expect(await runUserCli(cfg, ['create-admin', 'khong-phai-email', 'A'], typing())).toBe(1)
    expect(await runUserCli(cfg, ['create-admin', 'a@az.test'], typing())).toBe(1)
    expect(await inDb(listUsers)).toHaveLength(0)
    expect(await runUserCli(cfg, ['create-admin', 'a@az.test', 'A'], typing(PW, PW))).toBe(0)
    expect(await runUserCli(cfg, ['create-admin', 'A@az.test', 'A'], typing(PW, PW))).toBe(1)
  })

  it('--password-stdin chỉ đọc một lần; reset-password đổi mật khẩu', async () => {
    await runUserCli(cfg, ['create-admin', 'a@az.test', 'A', '--password-stdin'], typing(PW))
    expect(
      await runUserCli(
        cfg,
        ['reset-password', 'a@az.test', '--password-stdin'],
        typing('mat-khau-moi-4567'),
      ),
    ).toBe(0)
    const user = await inDb((db) => findUserByEmail(db, 'a@az.test'))
    expect(await verifyPassword('mat-khau-moi-4567', user?.password_hash ?? '')).toBe(true)
    expect(await verifyPassword(PW, user?.password_hash ?? '')).toBe(false)
    expect(
      await runUserCli(
        cfg,
        ['reset-password', 'khong-co@az.test'],
        typing('mat-khau-moi-4567', 'mat-khau-moi-4567'),
      ),
    ).toBe(1)
  })

  it('list và hướng dẫn', async () => {
    expect(await runUserCli(cfg, ['list'])).toBe(0)
    expect(await runUserCli(cfg, [])).toBe(0)
    expect(await runUserCli(cfg, ['xoa-het'])).toBe(1)
  })
})

describe('người dùng vào hàng đợi đồng bộ của VPS', () => {
  it('tạo và sửa người dùng ghi sync_outbox, đổi failed_logins thì không', async () => {
    await runUserCli(cfg, ['create-admin', 'a@az.test', 'A', '--password-stdin'], typing(PW))
    const sqlite = openDatabase(cfg.dbFile)
    try {
      const rows = () =>
        sqlite.sqlite.prepare("SELECT a FROM sync_outbox WHERE kind = 'user'").all() as {
          a: number
        }[]
      expect(rows()).toHaveLength(1)
      sqlite.sqlite.exec('DELETE FROM sync_outbox')
      sqlite.sqlite.exec('UPDATE users SET failed_logins = 2')
      expect(rows()).toHaveLength(0)
      sqlite.sqlite.exec("UPDATE users SET status = 'suspended'")
      expect(rows()).toHaveLength(1)
    } finally {
      sqlite.sqlite.close()
    }
  })
})
