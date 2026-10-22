-- Migration 0004: token Gateway cấp riêng cho từng người dùng.
-- Một token chỉ thuộc về MỘT người (owner_id) và chỉ cho Gateway nối vào hệ thống thay người đó:
-- mọi liên kết EA bind qua token này phải thuộc owner_id (liên kết chưa có chủ sẽ được gán cho
-- owner_id ở lần bind đầu). Không lưu token thô: chỉ lưu SHA-256 (token_hash) và 12 ký tự đầu
-- (token_prefix) để quản trị viên nhận diện. Bảng lạnh: chỉ ghi khi cấp, đặt lại, thu hồi và
-- (tối đa mỗi giờ một lần) khi cập nhật last_used_at.
-- Chưa có bảng users (Part 2) nên owner_id chưa có khóa ngoại; label là tên người để dễ đọc.

CREATE TABLE gw_tokens (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id     INTEGER NOT NULL,
  label        TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at   INTEGER
);

-- Mỗi người chỉ có tối đa một token đang hoạt động (muốn đổi thì "đặt lại" hoặc thu hồi rồi cấp mới).
CREATE UNIQUE INDEX ux_gw_tokens_active_owner ON gw_tokens (owner_id) WHERE status = 'active';