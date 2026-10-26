# Plan 5: Thông báo cảnh báo lỗ float

## 1. Mục tiêu
Báo cho người dùng khi một tài khoản giao dịch đang lỗ float vượt ngưỡng do chính họ đặt, rồi nhắc lại khi lỗ tăng thêm, và báo khi hết lệnh (clear). Thông báo hiện ở chuông trên thanh đầu của giao diện.

## 2. Luồng dữ liệu

```
EA (AZ_Spike.mq5) ── đo ngưỡng mỗi giây ──► Gateway (/v1/alert) ──► BE/Server (alert-service) ──► bảng notifications ──► FE (chuông)
        ▲                                        │  hàng chờ gửi lại, xóa khi có alert_ack          │
        └──── alert_bp (ngưỡng, điểm cơ bản) ◄───┴──────────── alert_cfg (ngưỡng + growth_mode) ◄───┘
```

- Ngưỡng và chế độ tính nằm ở cài đặt của từng người (`alert_settings`), mặc định tắt (`loss_pct = 0`).
- BE gửi `alert_cfg` xuống Gateway; Gateway trả `alert_bp` cho EA trong phản hồi. EA không biết người dùng là ai.
- VPS và Cloudflare đồng bộ hai chiều `alert_settings`, `alert_states`, `notifications` (xem Plan 3E).

## 3. Chế độ "tăng X%" (`growth_mode`)

| Chế độ | Cách tính | Ví dụ lỗ -1000 → -1200, Balance 10.000 |
|---|---|---|
| `balance` (mặc định) | mức lỗ tăng thêm / Balance hiện tại | tăng 2% |
| `float` | mức lỗ tăng thêm / mức lỗ lần báo trước | tăng 20% |

- Mức tăng tối thiểu để báo lại là 1% (cả hai chế độ).
- Chế độ lưu cùng ngưỡng của từng người. `PUT /api/settings/alerts` không gửi `growth_mode` thì giữ chế độ đang lưu.
- Migration: `BE/migrations/0009_alert_growth_mode.sql` (không sửa 0008). Dòng cũ nhận mặc định `balance`.

## 4. Quy tắc báo (`BE/src/services/alert-logic.ts`, hàm `decideAlert`)
- Cooldown 1 giờ giữa hai thông báo của cùng một đợt lỗ.
- Hết cooldown mới xét "increase": chỉ báo khi lỗ tăng đủ mức theo `growth_mode`.
- Đợt lỗ quá 7 ngày không cập nhật bị coi là cũ (`STALE_EPISODE_SEC`).
- Ba loại thông báo: vượt ngưỡng (breach), lỗ tăng thêm (increase), hết lệnh (clear, kèm `closed_pl`).
- Admin chỉ thấy thông báo của chính mình.

## 5. API

| Phương thức | Đường dẫn | Việc |
|---|---|---|
| GET | `/api/notifications?limit=30` | Danh sách mới nhất của người đăng nhập + số chưa đọc |
| POST | `/api/notifications/read` | Đánh dấu đã đọc: `{ ids: [...] }` hoặc `{ all: true }` |
| GET | `/api/settings/alerts` | Đọc `{ loss_pct, growth_mode }` |
| PUT | `/api/settings/alerts` | Lưu ngưỡng và chế độ. Khi Cloudflare chạy dự phòng thì trả 503 `READ_ONLY_FALLBACK` (khóa sửa ngưỡng) |

## 6. Gateway
- Nhận `alert_cfg`, trả `alert_bp` cho EA, endpoint `POST /v1/alert`.
- Hàng chờ gửi lại: tối đa 5 báo cáo mỗi terminal, gửi lại sau 30 giây, xóa khi có `alert_ack` (theo `aseq`).
- Terminal chưa bind: trả 409 để EA gửi lại sau; hub không ack báo cáo của terminal chưa bind.

## 7. EA `AZ_Spike.mq5` (0.4.0)
- Đọc `alert_bp`, đo ngưỡng mỗi giây, nhắc lại mỗi 60 giây khi còn vượt.
- Chỉ báo clear sau 3 lần đo liên tiếp thấy 0 lệnh (tránh báo nhầm lúc terminal mới khởi động).
- Giữ quy ước tệp ASCII + BOM.

## 8. Giao diện (FE)
- Chuông có huy hiệu số chưa đọc; bảng danh sách có trạng thái tải/lỗi/rỗng; nút "Đọc tất cả".
- Bấm thông báo thì đánh dấu đã đọc và mở liên kết.
- Cài đặt: ô ngưỡng (0 đến 100, dấu phẩy thập phân, sai thì báo lỗi và không gọi API) và nút chọn chế độ.
- Lỗi lưu hiển thị ngay trong ô cài đặt bằng message máy chủ trả về (kể cả `READ_ONLY_FALLBACK`).
- Nội dung thông báo luôn hiện dạng văn bản thuần.

## 9. Quyết định đã chốt
Ngưỡng theo từng người và mặc định tắt; admin chỉ thấy thông báo của mình; cooldown 1 giờ; khóa sửa ngưỡng khi Cloudflare chạy dự phòng; chế độ mặc định `balance`.

## 10. Kiểm thử
- Tự động (2026-10-26): Shared 119, BE 313, Server 163, Gateway 186, FE 223 test xanh; lint và typecheck sạch.
- **Chưa làm, cần người dùng:**
  - Biên dịch EA bằng MetaEditor ra `Installer/ea/*.ex5`, chạy A-01 đến A-07 trên terminal demo (`AZ_Sentinel_Manual_Test_EA.md`).
  - Thử tay chuỗi lỗ → nhắc lại 60 giây → clear.
  - Thử giao diện sáng/tối và màn hình hẹp (Rules FE).

## 11. Phát hành
Tăng version Gateway (0.3.2) và Server (0.2.3), gắn tag `[release]`, `[release-server]`, `[deploy]` theo `AZ_Sentinel_CI_Tags_And_Gateway_Power.md`. Chạy migration 0009 trên D1 remote trước khi deploy BE.
