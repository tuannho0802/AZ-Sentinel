# Giao dịch thủ công từ xa (v0.2.6, Pha 1)

Đảo ngược có chủ đích nguyên tắc "EA chỉ đọc" của Plan 1: quản trị viên đóng lệnh, đóng một phần và sửa SL/TP
từ trang chi tiết liên kết. **Pha 2 (đặt lệnh mới) chưa làm.**

## Đường đi của một lệnh
FE `POST /api/links/:id/trade` -> hub (`sendTrade`) -> Gateway (WS `trade`) -> EA (trường `tr_*` trong phản hồi
`/v1/ping` hoặc `/v1/samples`) -> EA thực thi -> `POST /v1/trade_result` -> Gateway -> hub -> người xem (`trade_result`).
202 từ server chỉ nghĩa là lệnh đã được chuyển đi; kết quả thật (retcode MT5) đến sau qua WebSocket.
Trang chi tiết đang ở chế độ live theo tick nên EA nhận lệnh trong vài trăm ms; lệnh không xếp hàng chờ.

## Các lớp an toàn (cả bốn đều phải đồng ý)
1. **EA:** `InpAllowRemoteTrading` mặc định `false`. Chủ terminal phải bật tay; server bị chiếm cũng không giao dịch được.
2. **Liên kết:** cờ `ea_links.trade_enabled` mặc định 0, chỉ admin bật (`POST /api/links/:id/trade-enabled`); gỡ gắn tài khoản thì tắt lại. Cờ này không đồng bộ sang Cloudflare nên bản dự phòng luôn coi là tắt.
3. **Quyền:** chỉ `root_admin` và `admin`. Route ghi dưới `/api/links` vốn đã bị chặn khi chạy dự phòng Cloudflare.
4. **Lệnh:** `cmd_id` duy nhất; hạn dùng 15 giây (EA chỉ bắt đầu khi còn >= 3 giây); EA ghi nhớ `cmd_id` (GlobalVariable) TRƯỚC khi gọi sàn nên tối đa một lần dù bị gửi trùng hay khởi động lại; mỗi liên kết chỉ một lệnh đang chờ; từ chối khi EA đã biết là cũ hơn 0.5.0.

Mọi lệnh ghi vào bảng `trade_log` (ai gửi, lệnh gì, kết quả). Khối lượng đóng một phần không được tự làm tròn: sai bước lot thì từ chối.

## `timeout` nghĩa là KHÔNG BIẾT
Quá hạn mà EA im thì kết quả là `timeout`: lệnh có thể đã chạy. FE nhắc xem lại bảng lệnh trước khi gửi lại. Kết quả muộn của EA vẫn được chuyển tiếp và ghi đè `timeout` (không ghi đè `done`).

## Triển khai v0.2.6
- Server `0.2.6` (có migration `0010_remote_trading.sql`), Gateway `0.3.4`, EA `0.5.0`. Commit `[release-server]` và `[release]` (Gateway) nếu muốn bộ cài mới; `[deploy]` cho Worker.
- **EA phải compile lại** (`ea/compile.ps1`) và thử trên **tài khoản demo** trước khi bật trên real. Mã MQL5 chưa được biên dịch hay chạy thử ở môi trường phát triển.
- Bật: đặt `InpAllowRemoteTrading = true` trên EA, rồi admin bật "Giao dịch từ xa" ở thẻ Tài khoản của liên kết.
