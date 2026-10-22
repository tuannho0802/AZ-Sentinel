import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { sha256Hex } from '../../BE/src/lib/crypto'
import {
  createToken,
  ensureDevToken,
  findActiveTokenByHash,
  resetToken,
  revokeToken,
} from '../../BE/src/services/gw-token-service'
import { runMigrations } from '../src/migrate'
import { openDatabase } from '../src/shim/d1'

const migrations = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../BE/migrations')
const asD1 = (db: ReturnType<typeof openDatabase>) => db as unknown as D1Database

function fresh() {
  const db = openDatabase(':memory:')
  runMigrations(db, migrations)
  return db
}

const outbox = (db: ReturnType<typeof openDatabase>) =>
  db.sqlite.prepare("SELECT kind, a FROM sync_outbox WHERE kind = 'token' ORDER BY seq").all() as {
    kind: string
    a: number
  }[]

describe('token Gateway trên SQLite của VPS', () => {
  it('cấp, tra, đặt lại, thu hồi chạy được trên node:sqlite và vào hàng đợi đồng bộ', async () => {
    const db = fresh()
    const d1 = asD1(db)
    const { token, row } = await createToken(d1, { ownerId: 7, label: 'A' }, 100)
    expect(await findActiveTokenByHash(d1, await sha256Hex(token))).toMatchObject({ id: row.id })
    expect(outbox(db)).toEqual([{ kind: 'token', a: row.id }])

    db.sqlite.exec('DELETE FROM sync_outbox')
    const reset = await resetToken(d1, row.id)
    expect(reset?.token).not.toBe(token)
    expect(await findActiveTokenByHash(d1, await sha256Hex(token))).toBeNull()
    expect(outbox(db)).toHaveLength(1)

    db.sqlite.exec('DELETE FROM sync_outbox')
    await revokeToken(d1, row.id, 200)
    expect(outbox(db)).toHaveLength(1)
    await expect(createToken(d1, { ownerId: 7, label: 'A' }, 300)).resolves.toBeTruthy()
  })

  it('cập nhật last_used_at không làm đầy hàng đợi đồng bộ', async () => {
    const db = fresh()
    const d1 = asD1(db)
    const { row } = await createToken(d1, { ownerId: 7, label: 'A' }, 100)
    db.sqlite.exec('DELETE FROM sync_outbox')
    db.sqlite.prepare('UPDATE gw_tokens SET last_used_at = 999 WHERE id = ?').run(row.id)
    expect(outbox(db)).toEqual([])
  })

  it('nâng cấp bảng outbox cũ (chỉ link/trade) mà không mất dòng đang chờ', async () => {
    const db = openDatabase(':memory:')
    runMigrations(db, migrations)
    // Giả lập DB của bản trước: outbox có CHECK cũ và đang chờ đẩy một liên kết.
    db.sqlite.exec(`
      DROP TRIGGER az_tokens_ai; DROP TRIGGER az_tokens_au;
      DROP TABLE sync_outbox;
      CREATE TABLE sync_outbox (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL CHECK (kind IN ('link', 'trade')),
        a INTEGER NOT NULL, b INTEGER NOT NULL DEFAULT 0, UNIQUE (kind, a, b));
      INSERT INTO sync_outbox (kind, a, b) VALUES ('link', 5, 0);
    `)
    runMigrations(db, migrations) // không có migration mới, chỉ chạy bước dựng lại lược đồ VPS
    expect(db.sqlite.prepare('SELECT kind, a FROM sync_outbox').all()).toEqual([
      { kind: 'link', a: 5 },
    ])
    const { row } = await createToken(asD1(db), { ownerId: 7, label: 'A' }, 100)
    expect(outbox(db)).toEqual([{ kind: 'token', a: row.id }])
  })

  it('ensureDevToken: tạo, giữ nguyên khi chạy lại, và thay token dev cũ của cùng người', async () => {
    const db = fresh()
    const d1 = asD1(db)
    const dev = 'azt_dev0123456789abcdef0123456789ab'
    await ensureDevToken(d1, dev, 1, 'Dev', 10)
    await ensureDevToken(d1, dev, 1, 'Dev', 20)
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM gw_tokens').get()).toEqual({ n: 1 })
    expect(await findActiveTokenByHash(d1, await sha256Hex(dev))).not.toBeNull()

    const other = 'azt_dev-khac-0123456789abcdef012345'
    await ensureDevToken(d1, other, 1, 'Dev', 30)
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM gw_tokens').get()).toEqual({ n: 1 })
    expect(await findActiveTokenByHash(d1, await sha256Hex(dev))).toBeNull()
    expect(await findActiveTokenByHash(d1, await sha256Hex(other))).not.toBeNull()
  })
})
