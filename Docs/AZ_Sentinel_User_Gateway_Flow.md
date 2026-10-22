# Luồng cài đặt cho Admin và User (mã kết nối)

## Vai trò

| Ai | Cài gì | Làm gì |
|---|---|---|
| Admin (VPS chính) | `AZSentinel-Server-Setup.exe` (Server + giao diện web) và `AZSentinel-Gateway-Setup.exe` | Đăng nhập web, duyệt người dùng, cấp token, gửi **mã kết nối** |
| User (VPS riêng có MT5) | Chỉ `AZSentinel-Gateway-Setup.exe` | Dán mã kết nối vào bộ cài, rồi đăng nhập web để xem dữ liệu của mình |
| Cloudflare | Worker (BE dự phòng) | Ngủ cho đến khi VPS chính sập |

## Admin: cài một lần (cài nhanh, không cần kỹ thuật)

1. Chạy `AZSentinel-Server-Setup.exe` trên VPS chính. Chọn **Cài nhanh** (mặc định), điền email, tên, mật khẩu admin, bấm Next cho tới khi xong. Bộ cài tự: chép Server và giao diện web, tạo tài khoản admin, đăng ký tự chạy khi bật máy, cài luôn AZ Gateway cho admin.
2. Trang cuối hiện địa chỉ (`http://127.0.0.1:8080/`) và email đăng nhập; shortcut **AZ Sentinel** ra Desktop.
3. Đăng nhập, trang **Tổng quan** có thẻ **Bắt đầu nhanh** (4 bước tự đánh dấu xong theo dữ liệu thật): thêm người dùng, cấp mã kết nối, Gateway nối vào, tài khoản MT5 xuất hiện.

Chỉ cần máy này và LAN thì dừng ở đây. **Để người dùng ở máy khác vào được** (cần HTTPS công khai) làm thêm một lần, chạy lại bộ cài với `/RECONFIGURE=1` rồi chọn **Tùy chỉnh nâng cao**:

- Tạo Cloudflare Tunnel (Zero Trust > Networks > Tunnels, hostname trỏ `http://localhost:8080`), dán **token tunnel** và **URL công khai của VPS**. Bộ cài tự cài `cloudflared`.
- Bản dự phòng Cloudflare (tùy chọn): `.\Scripts\setup-cloudflare.ps1 -VpsUrl https://<hostname-vps> -WorkerUrl https://<worker>.workers.dev`, commit + push, rồi dán Worker API, URL dự phòng, `SYNC_TOKEN` vào bộ cài.

Cài im lặng thêm: `/ADMINEMAIL= /ADMINNAME= /ADMINPASSWORD= [/ADVANCED=1 /TUNNELTOKEN= /PUBLICURL= /CLOUDURL= /FALLBACKURL= /SYNCTOKEN= /GATEWAY=0|1]`.

## Admin: cấp cho từng User

1. Vào **Token Gateway**, chọn người dùng, bấm **Cấp token**.
2. Hộp thoại hiện **Mã kết nối** (`azc1...`). Bấm **Sao chép lời mời**: được sẵn tin nhắn 3 bước (link tải bộ cài, mã, link đăng nhập) để dán vào Zalo/Telegram/email. Mã chỉ hiện một lần; mất thì **Đặt lại** để lấy mã mới.
3. Nếu hộp thoại báo chưa tạo được mã: VPS chưa biết địa chỉ công khai. Đặt `AZ_PUBLIC_URL`, khởi động lại Server rồi đặt lại token.

## User: 3 bước

1. Cài `AZSentinel-Gateway-Setup.exe` trên VPS có MT5.
2. Bộ cài chỉ hiện đúng một ô: dán mã kết nối rồi bấm Next (các ô URL/token đã ẩn, chỉ hiện khi tick "Tôi không có mã kết nối"). Bộ cài tự kiểm mã và chép EA vào các terminal MT5.
3. Mở web (URL admin cung cấp), đăng nhập. Tài khoản MT5 hiện ra sau khi EA nối vào.
   - **Không cần API key**: để trống `InpApiKey` trong EA, EA gửi khóa `auto` và BE tự tạo liên kết cho (server, login) dưới chủ token (tối đa 100 liên kết tự tạo mỗi người; liên kết của người khác bị từ chối). Vẫn dùng được khóa riêng như cũ.
   - Cần biên dịch lại EA (`ea/AZ_Spike.mq5` -> `Installer/ea/*.ex5`) để bản cài có hành vi này.

Quên dán lúc cài, hoặc nhận mã mới: mở giao diện Gateway (shortcut **AZ Gateway** trên Desktop), mục **Cài đặt**, dán mã vào ô "Mã kết nối", bấm **Lưu và khởi động lại**.

## Cài im lặng hàng loạt

```
AZSentinel-Gateway-Setup.exe /VERYSILENT /VPS=VPS-USER1 /CODE=azc1....
```
Bộ cài kiểm mã trước (mã sai/bị thu hồi thì dừng); thêm `/SKIPTOKENCHECK=1` để bỏ qua.

## Khi VPS chính sập

Mã kết nối mang sẵn cả địa chỉ dự phòng, nên Gateway của User tự chuyển sang Worker rồi tự quay về khi VPS sống lại (cơ chế Plan 3E). User mở URL web dự phòng để xem tiếp.

## Chưa làm / chưa kiểm chứng

- Không chạy test hay chạy thử thật. Cần thử trên máy thật: dán mã trong bộ cài, `apply-code`, ô dán mã trên giao diện Gateway, và bộ cài Server ghi `AZ_PUBLIC_URL`.
- Mã kết nối có token nên lộ mã = lộ token: dùng **Thu hồi** hoặc **Đặt lại** nếu nghi lộ.
- Bản FE tĩnh gọi thẳng API VPS rồi tự chuyển sang Worker (cookie khác origin, CORS) chưa làm: hiện Worker vẫn chuyển tiếp `/api/*` sang VPS khi VPS sống.
