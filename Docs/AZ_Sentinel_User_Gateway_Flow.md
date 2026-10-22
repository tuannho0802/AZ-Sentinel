# Luồng cài đặt cho Admin và User (mã kết nối)

## Vai trò

| Ai | Cài gì | Làm gì |
|---|---|---|
| Admin (VPS chính) | `AZSentinel-Server-Setup.exe` (Server + giao diện web) và `AZSentinel-Gateway-Setup.exe` | Đăng nhập web, duyệt người dùng, cấp token, gửi **mã kết nối** |
| User (VPS riêng có MT5) | Chỉ `AZSentinel-Gateway-Setup.exe` | Dán mã kết nối vào bộ cài, rồi đăng nhập web để xem dữ liệu của mình |
| Cloudflare | Worker (BE dự phòng) | Ngủ cho đến khi VPS chính sập |

## Admin: làm một lần

1. Chạy `AZSentinel-Server-Setup.exe` trên VPS chính. Ở trang cấu hình, điền **URL công khai của VPS** (hostname Cloudflare Tunnel hoặc tên miền, `https://...`) và URL web dự phòng (Worker). Có thể sửa sau trong `server.env` (`AZ_PUBLIC_URL`, `AZ_FALLBACK_URL`).
2. Tạo tài khoản admin đầu tiên: bộ cài có trang **Tài khoản quản trị đầu tiên** (email, tên, mật khẩu; cài im lặng: `/ADMINEMAIL= /ADMINNAME= /ADMINPASSWORD=`). Để trống thì tạo sau bằng `user.cmd create-admin <email> <tên>`.
3. Đăng nhập web bằng URL công khai. Vào **Người dùng** để thêm/duyệt User.

## Admin: cấp cho từng User

1. Vào **Token Gateway**, chọn người dùng, bấm **Cấp token**.
2. Hộp thoại hiện **Mã kết nối** (`azc1...`). Sao chép và gửi riêng cho User (mã chứa token, chỉ hiện một lần; mất thì **Đặt lại** để lấy mã mới).
3. Nếu hộp thoại báo chưa tạo được mã: VPS chưa biết địa chỉ công khai. Đặt `AZ_PUBLIC_URL`, khởi động lại Server rồi đặt lại token.

## User: 3 bước

1. Cài `AZSentinel-Gateway-Setup.exe` trên VPS có MT5.
2. Ở trang **Kết nối cloud**, dán mã kết nối vào ô đầu tiên, bấm Tiếp. Bộ cài tự kiểm mã và chép EA vào các terminal MT5.
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
