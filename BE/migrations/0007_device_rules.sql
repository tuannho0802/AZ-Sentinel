-- Migration 0007: Whitelist THIẾT BỊ (đi cùng whitelist IP của 0006).
-- Mỗi thiết bị có một mã ngẫu nhiên: trình duyệt giữ trong cookie `az_dev` (do Server cấp), Gateway giữ trong
-- file `device.id` và gửi bằng header `X-AZ-Device`. Server chỉ lưu bản băm (32 ký tự hex) của mã đó.
--   mode = 'any_ip'      : thiết bị này vào bằng IP nào thì IP đó được duyệt vào whitelist IP luôn.
--   mode = 'device_only' : chỉ duyệt thiết bị; IP lạ vẫn phải do quản trị viên duyệt.
-- Công tắc "chỉ thiết bị đã duyệt mới vào được" nằm ở server_meta (khóa `device_guard` = '1'), mặc định tắt.
CREATE TABLE device_rules (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id  TEXT NOT NULL UNIQUE,
  kind       TEXT NOT NULL DEFAULT 'web' CHECK (kind IN ('web', 'gateway')),
  label      TEXT NOT NULL DEFAULT '',
  mode       TEXT NOT NULL DEFAULT 'device_only' CHECK (mode IN ('any_ip', 'device_only')),
  last_ip    TEXT,
  last_seen  INTEGER,
  created_by INTEGER,
  created_at INTEGER NOT NULL
);

-- Thiết bị lạ vừa bị chặn (Server tự dọn) để quản trị viên bấm duyệt.
CREATE TABLE device_pending (
  device_id  TEXT PRIMARY KEY,
  kind       TEXT NOT NULL DEFAULT 'web',
  ip         TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  last_at    INTEGER NOT NULL,
  count      INTEGER NOT NULL DEFAULT 1
) WITHOUT ROWID;

-- IP do thiết bị 'any_ip' tự thêm: ghi nhớ thiết bị nào thêm để gỡ thiết bị thì gỡ luôn các IP đó.
ALTER TABLE ip_rules ADD COLUMN device_id TEXT;
-- IP bị chặn: ghi thêm thiết bị đã gửi request để quản trị viên biết ai đang cần duyệt.
ALTER TABLE ip_blocked ADD COLUMN device_id TEXT;
