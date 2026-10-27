-- Migration 0011: giao dịch từ xa Pha 2 (lệnh market, lệnh chờ, close all).
-- trade_log cần: (1) `op` nhận thêm 'market', 'pending', 'close_all'; (2) `ticket` có thể rỗng vì lệnh mới
--   và close_all không có ticket; (3) cột mô tả lệnh mới. SQLite không sửa được CHECK nên tạo bảng mới,
--   chép dữ liệu, xóa bảng cũ rồi đổi tên (cùng cách cho D1 của Cloudflare và SQLite của VPS).
--   Cột mới: `symbol` (market, pending); `kind` = hướng của market (buy|sell), loại lệnh chờ
--   (buy_limit|sell_limit|buy_stop|sell_stop) hoặc bộ lọc của close_all (all|profit|loss|buy|sell);
--   `price` = giá vào lệnh chờ; `volume`, `sl`, `tp` dùng chung như cũ.
CREATE TABLE trade_log_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id     INTEGER NOT NULL,
  user_id     INTEGER,
  cmd_id      TEXT NOT NULL,
  op          TEXT NOT NULL CHECK (op IN ('close', 'partial_close', 'modify', 'market', 'pending', 'close_all')),
  ticket      INTEGER,
  symbol      TEXT,
  kind        TEXT,
  volume      REAL,
  price       REAL,
  sl          REAL,
  tp          REAL,
  status      TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'done', 'failed', 'timeout')),
  reason      TEXT,
  code        INTEGER,
  detail      TEXT,
  created_at  INTEGER NOT NULL,
  finished_at INTEGER
);

INSERT INTO trade_log_new (id, link_id, user_id, cmd_id, op, ticket, volume, sl, tp, status, reason, code, detail, created_at, finished_at)
  SELECT id, link_id, user_id, cmd_id, op, ticket, volume, sl, tp, status, reason, code, detail, created_at, finished_at
  FROM trade_log;

DROP TABLE trade_log;
ALTER TABLE trade_log_new RENAME TO trade_log;

CREATE UNIQUE INDEX ux_trade_log_cmd ON trade_log (cmd_id);
CREATE INDEX ix_trade_log_link ON trade_log (link_id, created_at);
