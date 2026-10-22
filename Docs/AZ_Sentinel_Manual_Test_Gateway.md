# AZ Sentinel — Manual test luồng end-user qua Gateway (local)

> v0.1 · 21/10/2026 · Áp dụng sau patch 08 (BE) và patch 09 (FE). Thay phần "Test A/B" trong `AZ_Sentinel_Manual_Test_EA.md` cho luồng mới EA → Gateway → BE → FE.

## 0. Luồng dữ liệu

EA (MT5) → HTTP loopback → Gateway (127.0.0.1:47800) → WebSocket → BE `/api/gw/ws` (LiveHub) → WebSocket → FE (localhost:5173).
Đăng nhập thật (Part 2) chưa có, nên trang `/tokens` chưa dùng được ở bản deploy (dùng `token.cmd` hoặc `node server.mjs token ...` trên VPS). Test này chạy ở chế độ dev local, Gateway dev dùng token cố định `azt_dev...` (xem `AZ_Sentinel_Gateway_Token.md`). Thử bộ cài trên VPS Windows thật: danh sách kiểm ở `AZ_Sentinel_Gateway_Installer.md` mục 6 và `AZ_Sentinel_Server_Installer.md` mục 6.

## 1. Chuẩn bị (một lần)

```powershell
git pull
pnpm install
pnpm --filter @az-sentinel/api db:migrate:local
pnpm check
```

MT5: biên dịch `ea/AZ_Spike.mq5` (v0.2.0); Tools > Options > Expert Advisors > Allow WebRequest, thêm `http://127.0.0.1:47800` (bỏ mục `:8787` cũ). Chỉ một EA mỗi terminal.

## 2. Chạy 3 cửa sổ PowerShell (ở gốc repo)

| Cửa sổ | Lệnh |
|---|---|
| BE | `pnpm --filter @az-sentinel/api dev` |
| FE | `cd FE` rồi `pnpm dev` |
| Gateway | `$env:AZ_GW_CLOUD_URL="ws://127.0.0.1:8787/api/gw/ws"` rồi `pnpm --filter @az-sentinel/gateway start` |

Gateway in `đã nối cloud` khi nối được BE. Trang trạng thái: http://127.0.0.1:47800/.

## 3. Kịch bản

Đăng nhập http://localhost:5173 bằng tài khoản dev (`admin@az.local`) rồi vào `/links`.

| # | Làm gì | Kỳ vọng |
|---|---|---|
| E-01 | Bấm tạo liên kết | Hộp thoại hiện khóa (một lần) và "Địa chỉ cloud cho Gateway"; không còn ô URL ingest |
| E-02 | Dán khóa vào `InpApiKey`, gắn EA lên chart | Experts: `AZ: da gan voi lien ket tren cloud`. Gateway log `bind ok`. UI hiện tài khoản đã gắn và Online (bấm Làm mới nếu chưa đổi) |
| E-03 | Để mở `/links` với công tắc Live bật | Số liệu equity/balance cập nhật liên tục, huy hiệu Live. LƯU Ý: trang danh sách đã là một người xem (scope links), nên batch chảy ngay khi trang mở |
| E-04 | Bấm Tạm dừng Live (hoặc đóng hết tab) | Trong khoảng một chu kỳ ping Gateway ngừng gửi batch; cửa sổ Gateway không còn gửi mẫu |
| E-05 | Mở rồi đóng một lệnh demo | Sự kiện open/close; trang chi tiết có lệnh đúng, close có profit, commission; tải lại trang vẫn thấy |
| E-06 | Đổi SL/TP lệnh đang mở | Một sự kiện modify |
| E-07 | Ctrl+C Gateway | UI chuyển Offline; EA về GW_DOWN trong ~15 giây; bật lại Gateway thì EA về TRACK và UI Online lại |
| E-08 | Tắt BE rồi bật lại | Gateway tự nối lại (backoff 1, 2, 4... giây) và bind lại; FE tự nối lại và làm mới danh sách |
| E-09 | Bấm Khóa liên kết | Gateway log `bind bị từ chối ... mã 403`, live dừng. Mở khóa xong phải restart Gateway |
| E-10 | Cấp lại khóa, dán khóa mới vào InpApiKey | Gateway bind lại bằng khóa mới; khóa cũ bị từ chối |
| E-11 | Gỡ gắn rồi restart Gateway | Luồng đăng ký lần đầu chạy lại (kể cả tài khoản MT5 khác) |
| E-12 | Gắn EA thứ hai ở chart khác | Bản thứ hai tự từ chối |
| E-13 | Tắt rồi mở lại terminal MT5 | sid mới trong log, không mất sự kiện lúc tắt |

Kiểm tra thêm: giờ trong sự kiện (EA đổi giờ server sang UTC, làm tròn 15 phút) phải khớp giờ thực của lệnh.

## 4. Khi lỗi, gửi

- log cửa sổ BE và cửa sổ Gateway,
- tab Experts của MT5,
- tab Console của trình duyệt (F12) trên localhost:5173.

Lỗi 4014 trong Experts: chưa thêm `http://127.0.0.1:47800` vào Allow WebRequest.
