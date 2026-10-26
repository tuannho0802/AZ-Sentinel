-- Migration 0008: thông báo cảnh báo lỗ float (Plan 5).
-- alert_settings: một dòng mỗi người. `loss_bp` là ngưỡng lỗ float so với Balance theo basis point
--   (100 bp = 1%), 0 = tắt. Không có dòng = tắt. Người dùng tự đặt; Gateway của họ nhận qua `alert_cfg`.
-- alert_state: một dòng mỗi liên kết, nhớ "đợt cảnh báo" đang mở để không báo lặp trong 1 tiếng và để biết
--   lần báo trước mức lỗ là bao nhiêu (so sánh "tăng X% so với ... trước"). Chỉ ghi khi có báo cáo từ EA.
-- notifications: nội dung thông báo cho giao diện. `uid` là mã chung giữa VPS và Cloudflare (hai DB tự tăng
--   `id` riêng nên không thể dùng id để đồng bộ). `read_at` null = chưa đọc.
CREATE TABLE alert_settings (
  owner_id   INTEGER PRIMARY KEY,
  loss_bp    INTEGER NOT NULL DEFAULT 0 CHECK (loss_bp >= 0 AND loss_bp <= 10000),
  updated_at INTEGER NOT NULL
);

CREATE TABLE alert_state (
  link_id          INTEGER PRIMARY KEY,
  episode_open     INTEGER NOT NULL DEFAULT 0 CHECK (episode_open IN (0, 1)),
  ep_started_at    INTEGER,
  last_notified_at INTEGER,
  last_notified_fl REAL,
  last_aseq        INTEGER NOT NULL DEFAULT 0,
  updated_at       INTEGER NOT NULL
);

CREATE TABLE notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  uid        TEXT NOT NULL UNIQUE,
  owner_id   INTEGER NOT NULL,
  link_id    INTEGER,
  kind       TEXT NOT NULL CHECK (kind IN ('warn', 'increase', 'clear')),
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  data_json  TEXT,
  created_at INTEGER NOT NULL,
  read_at    INTEGER,
  updated_at INTEGER NOT NULL
);

-- Lý do: danh sách mới nhất của một người và đếm chưa đọc.
-- Chi phí: +1 dòng ghi mỗi thông báo (thông báo hiếm: tối đa vài lần mỗi tiếng mỗi tài khoản).
CREATE INDEX ix_notifications_owner ON notifications (owner_id, created_at);
