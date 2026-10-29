-- Migration 0013: bộ đếm đăng nhập sai cho email KHÔNG tồn tại.
-- Tài khoản thật đếm ở users.failed_logins/locked_until; nếu email giả không bị khóa tương tự thì kẻ lạ
-- thử 5 mật khẩu sai là biết email nào có thật (lần 6 ra 429, email giả mãi 401). Bảng này làm hai trường hợp
-- trả cùng chuỗi mã trạng thái. Dòng cũ hơn 7 ngày không có hoạt động bị dọn khi ghi.
CREATE TABLE login_throttle (
  email        TEXT PRIMARY KEY,
  failed       INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  updated_at   INTEGER NOT NULL
) WITHOUT ROWID;
