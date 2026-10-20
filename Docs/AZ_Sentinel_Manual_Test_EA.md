# AZ Sentinel — Thử đăng ký và theo dõi EA bằng giao diện (local)

> 2026-10-20. Bản thử của Part 1: màn hình Liên kết EA và `/api/dev/*` KHÔNG có phân quyền, chỉ chạy khi `pnpm dev`.

## Chuẩn bị

```powershell
git pull
pnpm install
pnpm check
Remove-Item -Recurse -Force BE\.wrangler\state -ErrorAction SilentlyContinue
pnpm db:migrate:local
pnpm dev
```

Mở http://localhost:5173, đăng nhập `admin@az.local` / `admin1234` (tài khoản giả lập), chọn menu **Liên kết EA**.

## Quy trình

1. Bấm **Tạo liên kết**. Sao chép **API key** và **URL** trong hộp thoại (khóa chỉ hiện một lần).
2. MT5: Tools → Options → Expert Advisors → Allow WebRequest, thêm `http://127.0.0.1:8787` (thử thêm `http://127.0.0.1` nếu MT5 từ chối cổng). Bật Algo Trading.
3. Biên dịch `ea/AZ_Spike.mq5`, gắn lên chart của tài khoản demo, điền `InpUrl`, `InpApiKey`.
4. Tab Experts phải có `http=200`. Trong web, bấm **Làm mới** (hoặc chờ 30 giây): liên kết hiện tài khoản, Online, equity; bấm **Xem** để đối chiếu với tab Trade của MT5.

## Kịch bản

| Kịch bản | Cách làm | Kỳ vọng |
|---|---|---|
| Đăng ký lần đầu | Bước 1 đến 4 | Chi tiết hiện đúng số tài khoản, server, broker, loại demo |
| Số liệu | So Balance/Equity/Margin/Free margin/Profit | Khớp MT5 (làm tròn 2 số lẻ) |
| Lệnh thay đổi | Mở một lệnh demo | Equity, Margin, lãi/lỗ đổi; danh sách lệnh vẫn rỗng (EA spike chưa gửi lệnh) |
| Tài khoản khác dùng cùng khóa | Đăng nhập MT5 tài khoản demo khác, giữ khóa | Experts `http=409`; sự kiện `auth_fail` hiện ở chi tiết |
| Khóa liên kết | **Khóa liên kết** | Experts `http=403`; **Mở lại** thì về 200 |
| Gắn lại | **Gỡ gắn tài khoản** | Dữ liệu cũ bị xóa; lần gửi kế tiếp gắn lại |
| Offline | Tắt EA, chờ hơn 60 giây, làm mới | Trạng thái Offline |
| Khóa sai | Sửa `InpApiKey` | `http=401` |

## Lưu ý

- Online/Offline do server tính theo ngưỡng 60 giây (EA gửi mỗi 10 giây). Cron đánh dấu offline thật là Part 5.
- Giới hạn 20 liên kết ở chế độ thử; xóa bớt bằng nút **Xóa liên kết**.
- Khi có Part 2/3: xóa `BE/src/routes/dev-links.ts` và thay màn hình bằng API có phân quyền (xem BE/FE Workflow).
