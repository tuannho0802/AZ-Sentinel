import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { ShimD1 } from './shim/d1'

/**
 * Bảng và trigger chỉ của máy chủ VPS: hàng đợi thay đổi để đẩy sang Cloudflare (outbox).
 * - `sync_outbox`: mỗi dòng là "khóa này đã đổi" (liên kết `link`/lệnh `trade`/token Gateway `token`/người dùng `user`/cài đặt cảnh báo `alert_cfg`/đợt cảnh báo `alert_state`/thông báo `notif`); khóa trùng thì dòng cũ bị
 *   thay (seq mới), nên một lệnh đổi trăm lần chỉ đẩy một lần. Nội dung đọc lại từ bảng gốc lúc đẩy.
 * - Trigger bị tắt khi `sync_state.mute = 1`: lúc áp dữ liệu kéo từ Cloudflare về thì không đẩy ngược lại.
 */
const SERVER_SCHEMA = `
CREATE TABLE IF NOT EXISTS sync_state (k TEXT PRIMARY KEY, v TEXT NOT NULL) WITHOUT ROWID;
INSERT OR IGNORE INTO sync_state (k, v) VALUES ('mute', '0');
UPDATE sync_state SET v = '0' WHERE k = 'mute';

CREATE TABLE IF NOT EXISTS sync_outbox (
  seq  INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('link', 'trade', 'token', 'user', 'alert_cfg', 'alert_state', 'notif')),
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
DROP TRIGGER IF EXISTS az_tokens_ai;
DROP TRIGGER IF EXISTS az_tokens_au;

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

-- Người dùng (Plan 4B). Chỉ đẩy khi đổi cột có ý nghĩa; failed_logins/locked_until thì không đẩy.
DROP TRIGGER IF EXISTS az_users_ai;
DROP TRIGGER IF EXISTS az_users_au;

CREATE TRIGGER az_users_ai AFTER INSERT ON users
WHEN (SELECT v FROM sync_state WHERE k = 'mute') = '0'
BEGIN INSERT OR REPLACE INTO sync_outbox (kind, a, b) VALUES ('user', NEW.id, 0); END;

CREATE TRIGGER az_users_au AFTER UPDATE OF email, display_name, password_hash, role, status ON users
WHEN (SELECT v FROM sync_state WHERE k = 'mute') = '0'
BEGIN INSERT OR REPLACE INTO sync_outbox (kind, a, b) VALUES ('user', NEW.id, 0); END;

-- Token Gateway (Plan 4). Chỉ đẩy khi đổi cột có ý nghĩa; cập nhật last_used_at thì không đẩy.
CREATE TRIGGER az_tokens_ai AFTER INSERT ON gw_tokens
WHEN (SELECT v FROM sync_state WHERE k = 'mute') = '0'
BEGIN INSERT OR REPLACE INTO sync_outbox (kind, a, b) VALUES ('token', NEW.id, 0); END;

CREATE TRIGGER az_tokens_au AFTER UPDATE OF owner_id, label, token_hash, token_prefix, status, revoked_at ON gw_tokens
WHEN (SELECT v FROM sync_state WHERE k = 'mute') = '0'
BEGIN INSERT OR REPLACE INTO sync_outbox (kind, a, b) VALUES ('token', NEW.id, 0); END;

-- Thông báo cảnh báo lỗ float (Plan 5). Thông báo đẩy khi tạo mới và khi đổi trạng thái đã đọc; \`id\` cục bộ là khóa hàng đợi,
-- nội dung gửi theo \`uid\` nên Cloudflare tự nhận ra bản đã có.
DROP TRIGGER IF EXISTS az_alert_cfg_ai;
DROP TRIGGER IF EXISTS az_alert_cfg_au;
DROP TRIGGER IF EXISTS az_alert_state_ai;
DROP TRIGGER IF EXISTS az_alert_state_au;
DROP TRIGGER IF EXISTS az_notif_ai;
DROP TRIGGER IF EXISTS az_notif_au;

CREATE TRIGGER az_alert_cfg_ai AFTER INSERT ON alert_settings
WHEN (SELECT v FROM sync_state WHERE k = 'mute') = '0'
BEGIN INSERT OR REPLACE INTO sync_outbox (kind, a, b) VALUES ('alert_cfg', NEW.owner_id, 0); END;

CREATE TRIGGER az_alert_cfg_au AFTER UPDATE ON alert_settings
WHEN (SELECT v FROM sync_state WHERE k = 'mute') = '0'
BEGIN INSERT OR REPLACE INTO sync_outbox (kind, a, b) VALUES ('alert_cfg', NEW.owner_id, 0); END;

CREATE TRIGGER az_alert_state_ai AFTER INSERT ON alert_state
WHEN (SELECT v FROM sync_state WHERE k = 'mute') = '0'
BEGIN INSERT OR REPLACE INTO sync_outbox (kind, a, b) VALUES ('alert_state', NEW.link_id, 0); END;

CREATE TRIGGER az_alert_state_au AFTER UPDATE ON alert_state
WHEN (SELECT v FROM sync_state WHERE k = 'mute') = '0'
BEGIN INSERT OR REPLACE INTO sync_outbox (kind, a, b) VALUES ('alert_state', NEW.link_id, 0); END;

CREATE TRIGGER az_notif_ai AFTER INSERT ON notifications
WHEN (SELECT v FROM sync_state WHERE k = 'mute') = '0'
BEGIN INSERT OR REPLACE INTO sync_outbox (kind, a, b) VALUES ('notif', NEW.id, 0); END;

CREATE TRIGGER az_notif_au AFTER UPDATE OF read_at ON notifications
WHEN (SELECT v FROM sync_state WHERE k = 'mute') = '0'
BEGIN INSERT OR REPLACE INTO sync_outbox (kind, a, b) VALUES ('notif', NEW.id, 0); END;
`

const ALL_TRIGGERS = [
  'az_links_ai',
  'az_links_au',
  'az_links_ad',
  'az_trades_ai',
  'az_trades_au',
  'az_trades_ad',
  'az_tokens_ai',
  'az_tokens_au',
  'az_users_ai',
  'az_users_au',
  'az_alert_cfg_ai',
  'az_alert_cfg_au',
  'az_alert_state_ai',
  'az_alert_state_au',
  'az_notif_ai',
  'az_notif_au',
]

/**
 * Bảng `sync_outbox` tạo từ bản cũ có CHECK thiếu loại mới (`token`, `user`, rồi `alert_cfg`/`alert_state`/`notif`); `CREATE TABLE IF NOT EXISTS` không
 * sửa được CHECK nên dựng lại bảng (giữ nguyên các dòng đang chờ đẩy). Trigger bị bỏ trước và được
 * `SERVER_SCHEMA` tạo lại ngay sau đó.
 */
function upgradeOutbox(sqlite: ShimD1['sqlite']): void {
  const row = sqlite
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sync_outbox'")
    .get() as { sql: string } | undefined
  if (!row || row.sql.includes("'notif'")) return
  sqlite.exec('BEGIN')
  try {
    for (const t of ALL_TRIGGERS) sqlite.exec(`DROP TRIGGER IF EXISTS ${t}`)
    sqlite.exec(`
      ALTER TABLE sync_outbox RENAME TO sync_outbox_old;
      CREATE TABLE sync_outbox (
        seq  INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL CHECK (kind IN ('link', 'trade', 'token', 'user', 'alert_cfg', 'alert_state', 'notif')),
        a    INTEGER NOT NULL,
        b    INTEGER NOT NULL DEFAULT 0,
        UNIQUE (kind, a, b)
      );
      INSERT INTO sync_outbox (seq, kind, a, b) SELECT seq, kind, a, b FROM sync_outbox_old;
      DROP TABLE sync_outbox_old;
    `)
    sqlite.exec('COMMIT')
  } catch (error) {
    sqlite.exec('ROLLBACK')
    throw error
  }
}

/**
 * Áp các migration của BE (`BE/migrations/*.sql`, cùng tệp mà D1 dùng) rồi tới lược đồ riêng của VPS.
 * Mỗi tệp chạy trong một giao dịch và chỉ một lần (ghi tên vào `_migrations`). Trả về tên các tệp vừa áp.
 */
export function runMigrations(db: ShimD1, dir: string): string[] {
  const sqlite = db.sqlite
  sqlite.exec(
    'CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)',
  )
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
      throw new Error(
        `Migration ${file} lỗi: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    applied.push(file)
  }
  // Phải chạy trước SERVER_SCHEMA: bảng cũ không có CHECK cho `token` thì trigger token sẽ lỗi khi bắn.
  upgradeOutbox(sqlite)
  sqlite.exec(SERVER_SCHEMA)
  return applied
}
