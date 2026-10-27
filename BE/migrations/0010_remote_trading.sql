-- Migration 0010: giao dịch thủ công từ xa (v0.2.6, Pha 1: đóng lệnh, đóng một phần, sửa SL/TP).
-- ea_links.trade_enabled: công tắc theo từng liên kết, MẶC ĐỊNH TẮT. Chỉ admin bật được. Cột này KHÔNG nằm
--   trong danh sách đồng bộ VPS <-> Cloudflare (LINK_COLS): bản dự phòng luôn coi là tắt, và upsert của
--   đồng bộ không bao giờ ghi đè cờ của VPS.
-- trade_log: nhật ký kiểm toán, một dòng mỗi lệnh. Ghi lúc gửi (status 'sent') và cập nhật khi EA báo kết
--   quả. Chỉ ghi khi có người bấm giao dịch nên không ảnh hưởng đường ghi nóng. cmd_id duy nhất để cập nhật
--   kết quả đúng dòng và chống ghi trùng. Không có khóa ngoại: xóa liên kết vẫn giữ dấu vết.
ALTER TABLE ea_links ADD COLUMN trade_enabled INTEGER NOT NULL DEFAULT 0 CHECK (trade_enabled IN (0, 1));

CREATE TABLE trade_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id     INTEGER NOT NULL,
  user_id     INTEGER,
  cmd_id      TEXT NOT NULL,
  op          TEXT NOT NULL CHECK (op IN ('close', 'partial_close', 'modify')),
  ticket      INTEGER NOT NULL,
  volume      REAL,
  sl          REAL,
  tp          REAL,
  status      TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'done', 'failed', 'timeout')),
  reason      TEXT,
  code        INTEGER,
  detail      TEXT,
  created_at  INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE UNIQUE INDEX ux_trade_log_cmd ON trade_log (cmd_id);
-- Lý do: kiểm tra "lệnh trước còn đang chờ" và xem lịch sử gần đây của một liên kết.
CREATE INDEX ix_trade_log_link ON trade_log (link_id, created_at);
