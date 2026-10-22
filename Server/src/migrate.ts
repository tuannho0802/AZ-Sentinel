import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { ShimD1 } from './shim/d1'

/**
 * Bảng và trigger chỉ của máy chủ VPS: hàng đợi thay đổi để đẩy sang Cloudflare (outbox).
 * - `sync_outbox`: mỗi dòng là "khóa này đã đổi" (liên kết `link`/lệnh `trade`); khóa trùng thì dòng cũ bị
 *   thay (seq mới), nên một lệnh đổi trăm lần chỉ đẩy một lần. Nội dung đọc lại từ bảng gốc lúc đẩy.
 * - Trigger bị tắt khi `sync_state.mute = 1`: lúc áp dữ liệu kéo từ Cloudflare về thì không đẩy ngược lại.
 */
const SERVER_SCHEMA = `
CREATE TABLE IF NOT EXISTS sync_state (k TEXT PRIMARY KEY, v TEXT NOT NULL) WITHOUT ROWID;
INSERT OR IGNORE INTO sync_state (k, v) VALUES ('mute', '0');
UPDATE sync_state SET v = '0' WHERE k = 'mute';

CREATE TABLE IF NOT EXISTS sync_outbox (
  seq  INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('link', 'trade')),
  a    INTEGER NOT NULL,
  b    INTEGER NOT NULL DEFAULT 0,
  UNIQUE (kind, a, b)
);

DROP TRIGGER IF EXISTS az_links_ai;
DROP TRIGGER IF EXISTS az_links_au;
DROP TRIGGER IF EXISTS az_links_ad;
DROP TRIGGER IF EXISTS az_trades_ai;
DROP TRIGGER IF EXISTS az_trades_au;
DROP TRIGGER IF EXISTS az_trades_ad;

CREATE TRIGGER az_links_ai AFTER INSERT ON ea_links
WHEN (SELECT v FROM sync_state WHERE k = 'mute') = '0'
BEGIN INSERT OR REPLACE INTO sync_outbox (kind, a, b) VALUES ('link', NEW.id, 0); END;

CREATE TRIGGER az_links_au AFTER UPDATE ON ea_links
WHEN (SELECT v FROM sync_state WHERE k = 'mute') = '0'
BEGIN INSERT OR REPLACE INTO sync_outbox (kind, a, b) VALUES ('link', NEW.id, 0); END;

CREATE TRIGGER az_links_ad AFTER DELETE ON ea_links
WHEN (SELECT v FROM sync_state WHERE k = 'mute') = '0'
BEGIN INSERT OR REPLACE INTO sync_outbox (kind, a, b) VALUES ('link', OLD.id, 0); END;

CREATE TRIGGER az_trades_ai AFTER INSERT ON trades
WHEN (SELECT v FROM sync_state WHERE k = 'mute') = '0'
BEGIN INSERT OR REPLACE INTO sync_outbox (kind, a, b) VALUES ('trade', NEW.link_id, NEW.ticket); END;

CREATE TRIGGER az_trades_au AFTER UPDATE ON trades
WHEN (SELECT v FROM sync_state WHERE k = 'mute') = '0'
BEGIN INSERT OR REPLACE INTO sync_outbox (kind, a, b) VALUES ('trade', NEW.link_id, NEW.ticket); END;

CREATE TRIGGER az_trades_ad AFTER DELETE ON trades
WHEN (SELECT v FROM sync_state WHERE k = 'mute') = '0'
BEGIN INSERT OR REPLACE INTO sync_outbox (kind, a, b) VALUES ('trade', OLD.link_id, OLD.ticket); END;
`

/**
 * Áp các migration của BE (`BE/migrations/*.sql`, cùng tệp mà D1 dùng) rồi tới lược đồ riêng của VPS.
 * Mỗi tệp chạy trong một giao dịch và chỉ một lần (ghi tên vào `_migrations`). Trả về tên các tệp vừa áp.
 */
export function runMigrations(db: ShimD1, dir: string): string[] {
    const sqlite = db.sqlite
    sqlite.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)')
    const done = new Set(
        (sqlite.prepare('SELECT name FROM _migrations').all() as { name: string }[]).map((r) => r.name),
    )
    const applied: string[] = []
    const files = readdirSync(dir)
        .filter((f) => f.endsWith('.sql'))
        .sort()
    for (const file of files) {
        if (done.has(file)) continue
        const sql = readFileSync(path.join(dir, file), 'utf8')
        sqlite.exec('BEGIN')
        try {
            sqlite.exec(sql)
            sqlite
                .prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)')
                .run(file, Math.floor(Date.now() / 1000))
            sqlite.exec('COMMIT')
        } catch (error) {
            sqlite.exec('ROLLBACK')
            throw new Error(`Migration ${file} lỗi: ${error instanceof Error ? error.message : String(error)}`)
        }
        applied.push(file)
    }
    sqlite.exec(SERVER_SCHEMA)
    return applied
}