-- Migration 0012: phân biệt liên kết do quản trị viên tắt với liên kết do chủ tự tắt.
-- disabled_by_admin = 1: admin đã tắt (vd. chặn lạm dụng, dừng giao dịch từ xa); chủ liên kết KHÔNG tự bật lại được.
-- Dòng cũ nhận 0 (không rõ ai tắt thì coi như chủ tắt, giữ nguyên hành vi trước đây).
ALTER TABLE ea_links ADD COLUMN disabled_by_admin INTEGER NOT NULL DEFAULT 0 CHECK (disabled_by_admin IN (0, 1));
