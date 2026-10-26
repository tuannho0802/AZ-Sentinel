-- Migration 0009: chế độ tính "đã tăng X%" của thông báo cảnh báo lỗ float (Plan 5).
-- growth_mode = 'balance': mức lỗ tăng thêm tính theo % của Balance hiện tại (mặc định).
--   Ví dụ Balance 10000, lỗ từ -1000 lên -1200 thì "tăng 2%".
-- growth_mode = 'float'  : mức lỗ tăng tương đối so với lỗ ở lần báo trước (-1000 lên -1200 là "tăng 20%").
-- Người dùng chuyển qua lại được. Dòng cũ (chưa có chế độ) nhận mặc định 'balance'.
ALTER TABLE alert_settings ADD COLUMN growth_mode TEXT NOT NULL DEFAULT 'balance' CHECK (growth_mode IN ('balance', 'float'));
