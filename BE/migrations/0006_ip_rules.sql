-- Migration 0006 (Plan 3F): Whitelist IP do quản trị viên quản lý. Máy chủ VPS đọc hai bảng này để quyết
-- định cho IP nào vào và giới hạn số kết nối WebSocket mỗi IP. Công tắc bật/tắt nằm ở server_meta
-- (khóa `ip_guard` = '1'); mặc định tắt nên cài mới không ai bị khóa ngoài.
CREATE TABLE ip_rules (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ip         TEXT NOT NULL UNIQUE,
  label      TEXT NOT NULL DEFAULT '',
  max_conns  INTEGER NOT NULL DEFAULT 5,
  created_by INTEGER,
  created_at INTEGER NOT NULL
);

-- IP bị chặn gần đây (tối đa vài chục dòng, Server tự dọn) để admin bấm "Cho phép".
CREATE TABLE ip_blocked (
  ip      TEXT PRIMARY KEY,
  last_at INTEGER NOT NULL,
  count   INTEGER NOT NULL DEFAULT 1
) WITHOUT ROWID;
