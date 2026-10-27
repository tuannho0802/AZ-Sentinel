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

## Thiết bị và whitelist
App có thể có kho cookie riêng (iOS luôn vậy) nên bị coi là thiết bị mới; xem mục "Cùng máy" trong `AZ_Sentinel_Whitelist_IP.md`: app cùng IP với trình duyệt đã duyệt được tự duyệt.

## Service worker
Cố ý tối giản (`FE/public/sw.js`): không cache giao diện/dữ liệu, không đụng `/api` hay WebSocket; chỉ hiện `offline.html` khi mở trang mà mất mạng. Đổi `offline.html` thì tăng `CACHE` trong `sw.js`.

## Phát hành
Worker (`[deploy]`: có `FE/public` mới và `run_worker_first` mới) và Server (`[release-server]`: gỡ thẻ manifest). Chưa thử cài thật trên các trình duyệt.
