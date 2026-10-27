# Whitelist IP (Plan 3F)

Mục tiêu: Admin và vài người tin cậy vào web / nối Gateway thẳng vào VPS 24/7, người lạ thì không, mà không cần thao tác kỹ thuật.

## Cách hoạt động
- Danh sách nằm trong SQLite của Server (`ip_rules`), công tắc ở `server_meta` (`ip_guard`). **Mặc định TẮT**: cài mới không ai bị khóa.
- **Tắt**: ai cũng vào được; IP có trong danh sách vẫn bị giới hạn số kết nối WebSocket (Gateway + trang live), mặc định **5**.
- **Bật**: chỉ IP khớp luật mới vào được (cả web lẫn Gateway). Máy chạy Server (loopback) và `/api/health` luôn vào được. IP lạ nhận 403 kèm đúng IP của họ để họ gửi cho Admin.
- Luật nhận IP (`1.2.3.4`), dải IPv4 (`1.2.3.0/24`) hoặc IPv6 đầy đủ. Qua Cloudflare Tunnel Server dùng IP thật trong `CF-Connecting-IP`.
- Danh sách còn nguyên khi Server/VPS khởi động lại (tác vụ "AZ Server" tự chạy lại): Gateway của các IP trong danh sách tự nối lại và tracking tiếp, không phải làm gì thêm.

## Admin dùng thế nào
1. Web → **Whitelist IP**. Bấm **Thêm IP của tôi** (IP hiện tại của bạn), thêm IP VPS của User (ví dụ A9), đặt nhãn và số kết nối tối đa.
2. Bấm **Bật bảo vệ**. Hệ thống từ chối bật nếu IP của bạn chưa có trong danh sách (chống tự khóa) và từ chối xóa luật cuối cùng của IP bạn khi đang bật.
3. User báo không vào được: IP của họ hiện ở **IP bị chặn gần đây**, bấm **Cho phép**.
4. Tự khóa mình ngoài web: trên VPS, PowerShell Administrator trong thư mục cài: `ip.cmd off` (hoặc `ip.cmd add <ip>`, `ip.cmd list`, `ip.cmd remove <ip>`, `ip.cmd on`).

Bộ cài Server có ô **IP được phép truy cập** (tùy chọn, cách nhau dấu phẩy; cài im lặng `/IPS=`). Có điền thì bộ cài nạp danh sách và bật bảo vệ luôn. Nhớ điền cả IP của bạn.

## Giới hạn cần biết
- Chặn chạy ở **Server VPS**. Bản dự phòng Cloudflare không áp whitelist (Gateway/Cloudflare dùng token); danh sách chưa đồng bộ sang Cloudflare.
- Người dùng vào qua địa chỉ Worker (Worker chuyển tiếp sang VPS): Worker chuyển IP thật kèm chữ ký HMAC (khóa `SYNC_TOKEN`), VPS chỉ tin khi chữ ký đúng nên whitelist vẫn đúng. Cần `AZ_SYNC_TOKEN` trùng với Worker và đồng hồ VPS đúng giờ (lệch quá 5 phút thì chữ ký bị từ chối). Xem `AZ_Sentinel_Quick_Tunnel.md` mục 4.
- IP điện thoại (4G/5G) hay đổi: cân nhắc thêm dải CIDR của nhà mạng hoặc dùng dải rộng hơn cho thiết bị di động.
- Chưa chạy test và chưa thử thật trên VPS; cần thử: bật bảo vệ, truy cập từ IP lạ (403), thêm bằng nút "Cho phép", kết nối thứ 6 của một IP (429).

---

# Whitelist thiết bị

Đi kèm whitelist IP: ngoài "IP nào được vào" còn có "**thiết bị nào** được vào". Giúp người dùng đổi IP liên tục (4G/5G, nhà mạng đổi IP) mà Admin không phải thêm tay từng IP.

## Thiết bị là gì
- **Trình duyệt**: lần đầu mở web, cấp cookie `az_dev` (HttpOnly, sống 400 ngày). Xóa cookie / đổi trình duyệt / chế độ ẩn danh = thiết bị mới.
  - **Đi qua địa chỉ Worker (khuyên dùng, Plan 3K):** cookie do **Worker** giữ (địa chỉ cố định) và được trao lại cho tunnel mỗi lần chuyển hướng, nên **cùng một trình duyệt luôn là cùng một thiết bị dù Quick Tunnel đổi địa chỉ** (cần `SYNC_TOKEN` giống nhau ở Worker và Server).
  - **Vào thẳng địa chỉ tunnel** (bookmark địa chỉ `*.trycloudflare.com`): cookie chỉ gắn với địa chỉ tunnel đó, tunnel đổi thì thành thiết bị mới. Luôn dùng địa chỉ Worker để vào.
- **Gateway**: tự tạo mã ngẫu nhiên lưu ở `<thư mục dữ liệu>/device.id` và gửi bằng header `X-AZ-Device`. Xóa file = thiết bị mới. Gateway ghi mã ngắn 8 ký tự vào log lúc khởi động (`mã thiết bị: ...`).
- Server chỉ lưu bản **băm** của mã (không lưu mã thô). Admin đối chiếu bằng mã ngắn 8 ký tự hiện trên web. Header `X-AZ-Device` và `X-AZ-Device-Id` do client gửi luôn bị Server gỡ trước khi chuyển cho BE.

## Hai chế độ khi duyệt một thiết bị
1. **Mọi IP** (`any_ip`): thiết bị vào bằng IP nào thì IP đó được **thêm luôn vào whitelist IP** (nhãn `Thiết bị: <nhãn>`, tối đa 5 kết nối như mặc định) và vào được ngay. Mỗi thiết bị giữ tối đa 20 IP tự thêm (quá thì bỏ IP cũ nhất). Gỡ thiết bị thì gỡ luôn các IP nó đã tự thêm.
2. **Chỉ thiết bị** (`device_only`): chỉ duyệt thiết bị. IP vẫn xét như thường: khi whitelist IP đang bật mà IP mới chưa có trong danh sách thì vẫn bị chặn, và Admin thấy IP đó (kèm thiết bị nào gửi) ở **IP bị chặn gần đây** để bấm **Cho phép**.

## Công tắc "Bật bảo vệ thiết bị"
- Mặc định **TẮT**: cài mới / nâng cấp không ai bị khóa. Thiết bị đã duyệt vẫn được ghi nhận và chế độ "Mọi IP" vẫn tự thêm IP.
- **Bật**: chỉ thiết bị đã duyệt (và máy chạy Server) mới vào được, dù IP hợp lệ. Thiết bị lạ nhận 403 kèm mã 8 ký tự để gửi cho Admin, và hiện ở **Thiết bị chờ duyệt**; Admin bấm "Cho phép (mọi IP)" hoặc "Cho phép (chỉ thiết bị)".
- Hệ thống từ chối bật nếu thiết bị của Admin chưa được duyệt, và từ chối gỡ thiết bị của chính Admin khi đang bật (chống tự khóa).
- Tự khóa mình: trên VPS, PowerShell Administrator trong thư mục cài: `ip.cmd device-off` (xem `ip.cmd device-list`, bật lại `ip.cmd device-on`).

## Admin dùng thế nào
1. Web → **Whitelist IP** → cuộn xuống **Whitelist thiết bị**. Bấm **Duyệt thiết bị của tôi** (chọn Mọi IP hoặc Chỉ thiết bị).
2. Bấm **Bật bảo vệ thiết bị**.
3. User báo không vào được: bảo họ đọc mã 8 ký tự trong thông báo 403 (Gateway thì xem log), tìm mã đó ở **Thiết bị chờ duyệt**, bấm Cho phép.

## Giới hạn cần biết
- Mã thiết bị là bí mật mang tính "vé": ai có cookie/`device.id` của máy đã duyệt là vào được như máy đó. Mất máy thì **Gỡ** thiết bị trên web.
- Giống whitelist IP, chặn chạy ở **Server VPS**; bản dự phòng Cloudflare không áp whitelist thiết bị và `Mã thiết bị của bạn` hiện "không xác định" khi Admin vào qua Cloudflare.
- Bật bảo vệ thiết bị thì **Gateway cũ** (chưa cập nhật, không gửi `X-AZ-Device`) bị chặn: cập nhật Gateway lên bản mới rồi duyệt trước khi bật.
- Chưa chạy test và chưa thử thật trên VPS; cần thử: duyệt thiết bị chế độ Mọi IP rồi đổi mạng (IP mới tự vào), chế độ Chỉ thiết bị với IP lạ (403 và hiện ở IP bị chặn), bật bảo vệ thiết bị với thiết bị lạ (403 + hiện ở chờ duyệt), gỡ thiết bị (IP tự thêm bị gỡ).

## Mã thiết bị đổi mỗi lần tunnel đổi (đã sửa ở Server 0.2.9)
Triệu chứng: cùng một trình duyệt, mỗi lần chạy lại Server (Quick Tunnel mới) lại bị `403` kèm một mã thiết bị mới; danh sách thiết bị được phép có nhiều dòng "Chrome · Windows" cùng IP. Nguyên nhân: cookie gắn theo tên miền mà tunnel có tên miền ngẫu nhiên mới mỗi lần.

Cách sửa (Plan 3K): Worker giữ cookie thiết bị ở địa chỉ cố định; khi chuyển hướng sang tunnel, Worker gắn tham số `az_dh` là **vé mã hóa AES-GCM** (khóa dẫn xuất từ `SYNC_TOKEN`, hạn 60 giây, mã thiết bị không lộ trong URL). Server giải vé, cấp lại cookie `az_dev` cho tunnel hiện tại, rồi chuyển hướng bỏ `az_dh` khỏi URL. Mỗi vé chỉ dùng một lần (Server nhớ nonce tới khi hết hạn). Vé sai/hết hạn/dùng lại bị bỏ qua êm: trình duyệt vẫn vào như trước, chỉ không được trao mã.

**Sau khi nâng cấp (làm một lần):** mã thiết bị của trình duyệt chuyển từ cookie trên tunnel sang cookie của Worker nên **mỗi trình duyệt là thiết bị mới đúng một lần**:
1. Cập nhật Worker (`[deploy]`) và Server 0.2.9 (`[release-server]`).
2. Nếu đang bật bảo vệ thiết bị và bị chặn: trên VPS chạy `ip.cmd device-off`.
3. Mở web bằng **địa chỉ Worker**, vào **Whitelist IP**, bấm **Duyệt thiết bị của tôi**, rồi **Bật bảo vệ thiết bị**. Các trình duyệt khác bị 403 thì gửi mã 8 ký tự cho Admin duyệt ở **Thiết bị chờ duyệt**.
4. Bấm **Bỏ** các dòng trình duyệt cũ bị trùng. Từ đó tunnel đổi bao nhiêu lần cũng không phải duyệt lại.

Giới hạn: Gateway không bị ảnh hưởng (mã nằm trong file `device.id`). Chưa thử thật trên Worker/tunnel Cloudflare; đã có test tự động cho vé và cho luồng hai tunnel liên tiếp.
