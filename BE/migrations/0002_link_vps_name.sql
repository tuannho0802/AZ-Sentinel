-- Migration 0002: tên VPS do người dùng tự nhập cho mỗi liên kết EA (để biết tài khoản đang chạy
-- ở VPS nào). Khác `link_state.vps_label` là nhãn Gateway tự báo (hostname). Bảng ea_links là bảng
-- lạnh (chỉ ghi khi tạo/sửa), nên thêm cột ở đây không ảnh hưởng đường ghi nóng.

ALTER TABLE ea_links ADD COLUMN vps_name TEXT;
