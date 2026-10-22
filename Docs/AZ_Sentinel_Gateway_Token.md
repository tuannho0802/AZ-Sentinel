# Token Gateway cá nhân (Plan 4)

## Nguyên tắc
- **Mỗi người một token** `azt_...` (36 ký tự), chỉ có tác dụng với đúng người đó. Mỗi người chỉ có **một** token đang hoạt động.
- Chỉ **quản trị viên** (`admin`, `root_admin`) cấp, đặt lại, thu hồi. Token thô **chỉ hiện một lần** (lúc cấp hoặc đặt lại); DB chỉ lưu SHA-256 và 12 ký tự đầu để nhận diện.
- Có token rồi người đó mới nối Gateway được; từ đó thêm tài khoản và EA qua Gateway. Liên kết EA bind qua token nào thì thuộc chủ token đó (liên kết chưa có chủ được gán ở lần bind đầu; liên kết của người khác bị từ chối 403).

## Cấp, đặt lại, thu hồi
Trang web: đăng nhập quản trị viên, mục **Token Gateway** (`/tokens`): cấp theo ID người dùng + tên, đặt lại, thu hồi, nút sao chép token. Đặt lại và thu hồi **ngắt ngay** Gateway đang dùng token đó (mã đóng 4003).

Dòng lệnh trên VPS (chưa có đăng nhập thật ở Part 2, nên đây là đường dùng được khi chạy thật):

```
node server.mjs token issue <owner_id> <tên>
node server.mjs token list
node server.mjs token reset <id>
node server.mjs token revoke <id>
```

Lệnh ghi thẳng SQLite, Server tự đồng bộ sang Cloudflare. Gateway đang nối bằng token cũ bị từ chối ở lần nối lại kế tiếp (không ngắt ngay như trang web).

## Đồng bộ VPS và Cloudflare
Bảng `gw_tokens` (migration `0004`) nằm ở cả hai nơi. VPS là nguồn gốc: mọi thay đổi vào hàng đợi `sync_outbox` (loại `token`) rồi đẩy lên `/api/sync/apply`; `last_used_at` mỗi nơi tự ghi, không đồng bộ. Lần khởi động đầu VPS kéo token Cloudflare đang có (`/api/sync/tokens`) rồi đẩy hết token của mình sang. Khi Cloudflare đang dự phòng, ghi token bị chặn (`READ_ONLY_FALLBACK`) như ghi liên kết.

## Gateway nối cloud
`Authorization: Bearer azt_...` (biến `AZ_GW_TOKEN` hoặc `cloudToken` trong `config.json`). `GET /api/gw/check` kiểm nhanh token: 200 hợp lệ, 401 sai/đã thu hồi.

## Dev
`pnpm dev`: Server dev tự tạo token cố định `azt_dev0123456789abcdef0123456789ab` cho người dùng dev (id 1) qua `AZ_DEV_GW_TOKEN`; Gateway dev dùng đúng token đó. Không có biến này ở bản thật.

## Bộ cài
- **Gateway** (`Installer/az-gateway.iss`): hỏi token cá nhân `azt_...`, kiểm hình dạng rồi gọi `az-gateway.exe check-token <url> <token>` (tức `GET /api/gw/check`); 401 thì chặn, không hỏi được cloud thì cho chọn tiếp tục. Cài im lặng: `/TOKEN=azt_...`, bỏ kiểm bằng `/SKIPTOKENCHECK=1`. Nâng cấp từ khóa chung cũ: bắt nhập token mới, chỉ đổi `cloudToken`. Chi tiết: `AZ_Sentinel_Gateway_Installer.md`.
- **Server + giao diện web** (`Installer/az-server.iss`): không hỏi token Gateway (token do quản trị viên cấp sau khi cài, bằng `token.cmd` hoặc trang `/tokens`). Chi tiết: `AZ_Sentinel_Server_Installer.md`.
- Giao diện Gateway chỉ nhận token `azt_...` ở ô Cài đặt (khóa chung cũ bị từ chối ngay khi lưu).

## Còn lại
- Đăng nhập thật (Part 2): khi có, thay `resolveViewer` thì trang `/tokens` và API `/api/admin/gw-tokens` dùng được ở bản thật.
- Xóa biến `GW_CONNECT_TOKEN` khỏi Worker đã deploy: `wrangler secret delete GW_CONNECT_TOKEN`.
