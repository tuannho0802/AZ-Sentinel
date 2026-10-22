-- Migration 0003 (Plan 3E): bảng khóa-giá trị nhỏ cho thông tin máy chủ. Hiện chỉ dùng để Worker nhớ
-- nhịp sống gần nhất của VPS chính (khóa `primary_node`), nhờ đó giao diện chế độ dự phòng vẫn hiện
-- được thông tin VPS lần cuối khi VPS đã sập. Bảng mới, không đụng bảng nóng.
CREATE TABLE server_meta (
  k          TEXT PRIMARY KEY,
  v          TEXT NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;