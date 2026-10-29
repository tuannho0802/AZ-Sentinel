# Gia cố bảo mật (đợt rà soát 2026-10-29)

| # | Vấn đề | Cách xử lý | Nơi sửa |
|---|---|---|---|
| 1 | Socket live không bị đóng khi khóa/đổi vai trò/đặt lại mật khẩu | `kickUserAtHub` gọi trong `PATCH /admin/users/:id` | `BE/src/live/kick.ts`, `routes/admin-users.ts` |
| 2 | Thiếu header bảo mật (clickjacking trên nút giao dịch) | CSP, `frame-ancestors 'none'`, `X-Frame-Options`, nosniff, HSTS (khi HTTPS) cho Worker, VPS và `_headers` | `Shared/src/security-headers.ts`, `BE/src/middleware/security-headers.ts`, `Server/src/http.ts`, `FE/public/_headers` |
| 3 | Route EA của Gateway nhận được POST chéo nguồn từ trình duyệt | Chỉ nhận request có `Content-Type: application/json`, không có `Origin`/`Sec-Fetch-Site` | `Gateway/src/local-server.ts` |
| 4 | `AZ_DEV_LINKS_API=1` tắt toàn bộ xác thực, không có chốt chặn | Server từ chối khởi động nếu bật cùng host không loopback, Quick Tunnel hoặc Worker thật | `Server/src/config.ts` |
| 5 | `dev:public` dùng token Gateway cố định (public trong repo) qua tunnel | Sinh token ngẫu nhiên mỗi lần chạy | `Scripts/dev-public.mjs` |
| 6 | `AZ_SYNC_TOKEN` không bị ép độ dài | Từ chối nếu < 32 ký tự (trừ chế độ dev) | `Server/src/config.ts` |
| 7 | `INGEST_DEBUG_META=1` được deploy lên production | Mặc định `0`; test và `pnpm dev` bật tường minh | `BE/wrangler.jsonc`, `BE/vitest.config.ts`, `BE/package.json` |

Lưu ý khi sửa `UI_CSP`: cập nhật cả `FE/public/_headers` (test `Shared/test/security-headers.test.ts` canh lệch).
`connect-src` cho phép `https:`/`wss:` vì trang tự dò địa chỉ bản dự phòng ở origin khác (failover).

## Chưa xử lý (cần quyết định thiết kế)
- Giới hạn đăng nhập sai chưa atomic; chưa có rate limit theo IP trên VPS; PBKDF2 100k vòng.
- Worker nhận mọi tunnel URL https từ `SYNC_TOKEN`; FE failover redirect tới mọi origin; `SYNC_TOKEN` dùng chung nhiều mục đích.
- `adoptSameMachine` tự duyệt thiết bị cùng IP; chữ ký IP của Worker chưa gắn với request.
- Chưa có 2FA/xác thực lại cho giao dịch từ xa; phiên 7 ngày không xoay vòng.
- Chuỗi cung ứng: dependency `latest`, GitHub Action ghim theo tag, chưa ký số `.exe`.
