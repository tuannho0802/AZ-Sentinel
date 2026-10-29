# PWA: cài giao diện như một ứng dụng

Mục tiêu: mở địa chỉ Worker trong trình duyệt rồi **Cài ứng dụng**, sau đó mở từ màn hình chính/thanh tác vụ như app.

## Vì sao chỉ cài từ địa chỉ Worker
PWA gắn với origin. Worker có địa chỉ cố định và chuyển hướng (302) lượt mở trang sang Quick Tunnel đang sống (Plan 3J); tunnel đổi địa chỉ mỗi lần chạy lại, nên app cài từ tunnel sẽ chết ở lần sau. Vì vậy:
- `FE/index.html` có thẻ `<link rel="manifest" data-az-pwa>`; **Server VPS gỡ thẻ này** khi phục vụ (`Server/src/static.ts`), nên chỉ bản do Worker phục vụ mới cài được.
- Service worker chỉ được đăng ký khi trang có thẻ manifest, tức không đăng ký trên tunnel/VPS.
- `start_url` là `/` (không có `az_stay`): mỗi lần mở app Worker lại đi tìm tunnel đang sống.

## Cài thế nào
1. Đang ở trang qua tunnel: banner **Cài AZ Sentinel như một ứng dụng** → **Mở trang cài đặt** (mở địa chỉ Worker với `?az_stay=1` để Worker phục vụ giao diện thay vì chuyển hướng ngược về tunnel). Có thể tự mở `https://<worker>/?az_stay=1`.
2. Chrome/Edge/Android: bấm **Cài ứng dụng** trong banner (hoặc biểu tượng cài ở thanh địa chỉ). Safari iOS: Chia sẻ → Thêm vào Màn hình chính (banner có hướng dẫn).
3. Mở app: Worker chuyển sang tunnel đang sống. App nằm ngoài phạm vi origin Worker nên trình duyệt hiện thanh địa chỉ nhỏ (Android) hoặc thanh tiêu đề có URL (máy tính). Muốn thuần app phải để Worker reverse-proxy, tốn request Worker và đi ngược Plan 3J.

## Vì sao mở app chậm hơn mở thẳng URL tunnel, và cách giảm (Server 0.2.10)
Mỗi lần mở app đi qua một chuỗi, trong khi mở thẳng URL tunnel trong trình duyệt thì bỏ qua gần hết:

1. Service worker khởi động (trên điện thoại thường đang "ngủ").
2. Worker đọc D1 lấy địa chỉ tunnel, **dò** `/api/health` của tunnel (tối đa ~2,5 giây khi dò nguội), rồi trả 302.
3. Trình duyệt sang `*.trycloudflare.com`: DNS, TLS, route mới; PWA ra khỏi scope.
4. Trước 0.2.10: VPS **trả thêm một 302** để gỡ tham số vé `az_dh` khỏi URL (xem `AZ_Sentinel_Quick_Tunnel.md`, Plan 3K).
5. Tải HTML, gói JS, rồi chờ `/api/me` mới vẽ được giao diện (màn "Đang kiểm tra phiên đăng nhập").

Các thay đổi:

| Thay đổi | Ở đâu | Tác dụng |
|---|---|---|
| Phục vụ trang ngay khi có vé `az_dh` (không còn 302 thứ hai); cookie thiết bị gắn vào chính phản hồi, `dropStayParam` gỡ `az_dh` khỏi thanh địa chỉ | `Server/src/http.ts`, `Server/src/device-handoff.ts`, `FE/src/lib/failover.ts` | Bớt một vòng mạng qua tunnel. Chỉ áp cho lượt tải trang (`Sec-Fetch-Dest: document`); request khác vẫn 302 như cũ |
| Nén brotli/gzip cho `.html .js .css .json .svg...`, nén một lần rồi giữ trong RAM, kèm `Vary: Accept-Encoding` | `Server/src/static.ts` | Phần JS tải khi vào Tổng quan (hai gói `index` + `AppShell`, ~450 KB) còn ~129 KB (brotli) hoặc ~138 KB (gzip); trước đó 532 KB đi nguyên khối nếu không ai nén hộ. Không phụ thuộc việc Cloudflare có tự nén cho Quick Tunnel hay không |
| Nhớ người dùng đã đăng nhập (`localStorage` khóa `az.me`, chỉ thông tin hiển thị), vẽ giao diện ngay rồi xác nhận phiên ngầm | `FE/src/lib/session-cache.ts`, `FE/src/features/auth/api.ts` | Không còn chờ `/api/me` trước khi thấy giao diện. Hết phiên: `/api/me` trả 401, bộ nhớ bị xóa, về trang đăng nhập. Phân quyền thật vẫn ở BE |
| Tách code các trang phụ (`React.lazy`: Links, Link chi tiết, Tokens, IP, Users) | `FE/src/App.tsx` | Gói tải đầu giảm khoảng 18% (532 KB còn ~450 KB trước nén); mức giảm khiêm tốn, không phải nguyên nhân chính |
| Navigation preload | `FE/public/sw.js` | Request mở trang gửi song song lúc service worker khởi động |
| Dòng **Mở trang** ở thẻ "Máy chủ" trên Tổng quan | `FE/src/lib/perf.ts`, `ServerStatusCard.tsx` | Hiện `HTML · JS · hiện · phiên` (giây, tính từ lúc chạm icon) để biết thời gian mất ở khâu nào |

Cách đọc dòng **Mở trang** (mốc tính từ lúc bắt đầu điều hướng, nên đã gồm cả service worker, Worker, chuyển hướng, DNS/TLS):
- **HTML** lớn: chậm ở Worker hoặc tunnel (dò nguội, D1, route Quick Tunnel). Cách tận gốc là Cloudflare Tunnel có tên và domain cố định, khi đó không cần Worker chuyển hướng.
- **JS** cách **HTML** xa: gói JS tải chậm (kiểm tra có nén: `curl -sI -H "Accept-Encoding: br" https://<tunnel>/assets/<tệp>.js`).
- **hiện** cách **JS** xa: hiếm; xem bộ nhớ phiên (`az.me`) có bị trình duyệt chặn không.
- **phiên** lớn hơn **hiện** nhiều: `/api/me` chậm nhưng người dùng đã thấy giao diện nên không còn cảm giác chờ.

Chưa đo trên điện thoại thật; các con số gói JS ở trên đo từ bản build trên máy dev.

## Thiết bị và whitelist
App có thể có kho cookie riêng (iOS luôn vậy) nên bị coi là thiết bị mới; xem mục "Cùng máy" trong `AZ_Sentinel_Whitelist_IP.md`: app cùng IP với trình duyệt đã duyệt được tự duyệt.

## Service worker
Cố ý tối giản (`FE/public/sw.js`): không cache giao diện/dữ liệu, không đụng `/api` hay WebSocket; chỉ hiện `offline.html` khi mở trang mà mất mạng, và bật navigation preload để request mở trang không phải chờ service worker khởi động. Đổi `offline.html` thì tăng `CACHE` trong `sw.js`. `sw.js` do **Worker** phục vụ (cùng origin với app đã cài) nên muốn máy đã cài nhận bản mới phải deploy Worker.

## Phát hành
Worker (tag deploy: có `FE/public` mới, `sw.js` mới và `run_worker_first` mới) và Server (tag release-server: gỡ thẻ manifest, phục vụ trang ngay khi có vé, nén, giao diện mới; tăng `version` trong `Server/package.json`, bản tối ưu mở app là 0.2.10). Chưa thử cài thật trên các trình duyệt.
