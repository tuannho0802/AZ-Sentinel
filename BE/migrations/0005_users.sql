-- Migration 0005: người dùng và phiên đăng nhập thật (Plan 4B).
-- users: email là duy nhất (không phân biệt hoa thường, luôn lưu chữ thường). Mật khẩu chỉ lưu dạng
-- băm PBKDF2-SHA256 có muối, định dạng `pbkdf2-sha256$<vòng lặp>$<muối>$<băm>`.
-- failed_logins/locked_until: khóa tạm tài khoản khi nhập sai nhiều lần (chỉ ghi khi sai hoặc khi gỡ khóa).
-- sessions: lưu SHA-256 của mã phiên (mã thô nằm trong cookie HttpOnly), có hạn.
-- gw_tokens.owner_id trỏ tới users.id (chưa đặt khóa ngoại để không phá dữ liệu cũ và token dev).

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('root_admin', 'admin', 'user')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'rejected', 'suspended')),
  created_at    INTEGER NOT NULL,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until  INTEGER
);

CREATE TABLE sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX ix_sessions_user ON sessions (user_id);