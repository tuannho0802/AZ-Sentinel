# Quick Tunnel tự theo (Plan 3G): không cần tên miền, VPS reset vẫn vào được

> v0.1 · 23/10/2026 · **Chưa thử trên Windows/Cloudflare thật.** Phần Node/TypeScript đã có test và đã chạy thử với `cloudflared` giả; việc tải `cloudflared.exe`, tác vụ "AZ Server" và Worker thật cần chạy thử trên VPS (mục 6).

## 1. Vấn đề và cách giải

Quick Tunnel (`*.trycloudflare.com`) miễn phí, không cần tên miền, nhưng **địa chỉ đổi mỗi lần `cloudflared` chạy lại** (VPS reset, Server khởi động lại). Cách giải: dùng **Worker Cloudflare làm cửa trước có địa chỉ cố định** (`*.workers.dev`, miễn phí). Mỗi khi địa chỉ tunnel đổi, VPS tự báo địa chỉ mới cho Worker; Worker chuyển tiếp mọi request `/api/*` (kể cả WebSocket của Gateway) tới địa chỉ hiện tại.

```
Người dùng / Gateway ──► Worker (workers.dev, CỐ ĐỊNH)
                              │  chuyển tiếp tới địa chỉ tunnel "hiện tại" (lưu trong D1)
                              ▼
                    xxxx.trycloudflare.com ──► VPS (Server)

VPS khởi động ─► Server chạy cloudflared ─► đọc địa chỉ mới ─► POST /api/sync/heartbeat ─► Worker nhớ địa chỉ mới
```

Người dùng và Gateway **chỉ dùng địa chỉ Worker**, nên không biết và không cần biết địa chỉ tunnel đã đổi.

## 2. Hành vi khi VPS reset

1. VPS sập: Worker không tới được địa chỉ cũ nên tự chạy **chế độ dự phòng** (đúng như Plan 3E: xem được dữ liệu, ghi bị chặn trừ khi bật `FALLBACK_WRITABLE`).
2. VPS lên lại, tác vụ "AZ Server" tự chạy, Server dọn `cloudflared` sót, mở Quick Tunnel mới và đọc địa chỉ (thường 5-15 giây).
3. Server báo địa chỉ mới cho Worker; nếu Worker chưa nhận được thì thử lại sau 5 giây, giãn dần (tối đa 12 lần). Worker ghi vào D1 và dùng ngay trong isolate đó; các isolate khác thấy sau tối đa 10 giây.
4. Worker quay về chuyển tiếp sang VPS. Gateway tự nối lại (Gateway thử địa chỉ chính rồi dự phòng, cả hai đều là địa chỉ Worker).

Khoảng gián đoạn ≈ thời gian VPS khởi động + 15-30 giây tunnel. Trong lúc đó người dùng vẫn mở được bản dự phòng.

Server còn tự kiểm tra tunnel mỗi 60 giây (gọi `/api/health` qua chính địa chỉ tunnel, bỏ qua 30 giây đầu); hỏng 3 lần liên tiếp thì tự khởi động lại `cloudflared` và báo địa chỉ mới.

## 3. Cài đặt (làm một lần)

**Trên Cloudflare** (Worker của dự án này, `az-sentinel-api`, và web `az-sentinel-web`, deploy bằng tag deploy như `AZ_Sentinel_CI_Tags_And_Gateway_Power.md`):

1. Tạo `SYNC_TOKEN`: một chuỗi ngẫu nhiên >= 32 ký tự. `wrangler secret put SYNC_TOKEN` (cho Worker API).
2. **Không đặt `VPS_ORIGIN`** (Worker tự học địa chỉ từ VPS). Nếu đã đặt thì địa chỉ VPS báo lên vẫn thắng; VPS báo "không dùng Quick Tunnel" thì quay về `VPS_ORIGIN`.
3. Ghi địa chỉ Worker (ví dụ `https://az-sentinel-api.<tài-khoản>.workers.dev`) để dùng ở bước dưới.

**Trên VPS** (đã cài bộ cài Server, `server.env` đã có `AZ_CLOUD_URL` = địa chỉ Worker API và `AZ_SYNC_TOKEN` trùng với Worker). PowerShell Administrator, trong thư mục cài:

```powershell
.\quick-tunnel.ps1 -WorkerUrl https://az-sentinel-api.<tài-khoản>.workers.dev
.\quick-tunnel.ps1 -Show      # sau 30-60 giây: xem địa chỉ tunnel hiện tại
```

Script đặt `AZ_QUICK_TUNNEL=1` và `AZ_PUBLIC_URL=<địa chỉ Worker>` trong `server.env` rồi khởi động lại "AZ Server". Làm tay cũng được: sửa hai dòng đó, khởi động lại tác vụ. Tắt: `.\quick-tunnel.ps1 -Off`.

- `AZ_PUBLIC_URL` phải là **địa chỉ Worker** (cố định), không phải địa chỉ `trycloudflare.com`, vì đó là địa chỉ đưa vào mã kết nối Gateway.
- `cloudflared.exe` tự tải về `C:\ProgramData\AZSentinelServer` lần chạy đầu (cần VPS ra được `github.com`). Đặt `AZ_CLOUDFLARED` nếu muốn dùng tệp có sẵn. Tệp `tunnel-url.txt` cùng thư mục ghi địa chỉ hiện tại.
- Cài đè bằng bộ cài với `/RECONFIGURE=1` sẽ ghi lại `server.env` và làm mất hai dòng này (xem `AZ_Sentinel_Server_Installer.md`): chạy lại `quick-tunnel.ps1`.

**Cấp Gateway:** Start menu > Quản lý token Gateway > `token issue ...`; mã kết nối/Cloud URL của Gateway dùng địa chỉ Worker (`wss://<worker>/api/gw/ws`), ô dự phòng cũng điền địa chỉ Worker.

## 4. Whitelist IP khi đi qua Worker

Qua Worker, VPS chỉ thấy IP của Cloudflare. Worker chuyển IP thật của người dùng bằng ba header `X-AZ-Client-IP`, `X-AZ-Edge-Ts`, `X-AZ-Edge-Sig`; chữ ký là HMAC-SHA256 (khóa = `SYNC_TOKEN`) trên `IP|mốc giờ`.

- VPS **chỉ tin IP trong header khi chữ ký đúng** và mốc giờ lệch không quá 5 phút. Client tự đặt header thì bị bỏ qua và gỡ khỏi request; mạo danh IP được phép không qua mặt được whitelist.
- Vì vậy Whitelist (Plan 3F) hoạt động đúng cả khi đi qua Worker, không cần cấu hình thêm. IP lạ vẫn nhận 403 kèm đúng IP của họ; nút "Thêm IP của tôi" ghi đúng IP thật.
- Đồng hồ VPS Windows phải đúng (tự đồng bộ giờ). Lệch quá 5 phút thì mọi người dùng qua Worker bị coi là IP của Cloudflare.
- Whitelist chỉ áp ở VPS, không áp ở bản dự phòng Cloudflare (như cũ).

## 5. Giới hạn và rủi ro

- **Mọi truy cập đi qua Worker nên tính vào hạn mức request của gói free Cloudflare.** Plan 3E cũng nêu điều này. Theo dõi mức dùng; vượt thì Worker bị giới hạn và cả web lẫn Gateway chịu ảnh hưởng.
- **Quick Tunnel do Cloudflare ghi rõ là chỉ để thử nghiệm và phát triển, không cam kết SLA hay thời gian hoạt động** (tài liệu `developers.cloudflare.com/tunnel/get-started/quick-tunnels/`). Muốn ổn định lâu dài hãy dùng tunnel có tên và tên miền (Plan 3E).
- Mỗi Quick Tunnel nhận tối đa **200 request đồng thời**, vượt thì trả HTTP 429. Quick Tunnel **không hỗ trợ SSE**, nhưng dự án này không dùng SSE (Gateway và trang live dùng WebSocket; `pnpm dev:public` của repo cũng cho Gateway nối WebSocket qua Quick Tunnel). Việc WebSocket chạy ổn qua Worker rồi qua Quick Tunnel trên VPS thật vẫn cần thử (mục 6).
- Quick Tunnel không chạy đúng nếu thư mục `.cloudflared` của tài khoản chạy Server (SYSTEM) có sẵn `config.yaml` (do tunnel có tên cấu hình tay để lại). Server cài bằng `setup-tunnel.ps1` (token) không tạo tệp này; nếu từng cấu hình tay thì xóa/đổi tên tệp đó.
- Có khoảng gián đoạn ngắn mỗi lần reset (mục 2). Gateway nối vào Worker trong lúc dự phòng vẫn được nhận (token đã đồng bộ sang D1).
- Địa chỉ báo lên phải là `https`, không IP thô/`localhost`/cổng lạ/tài khoản trong URL. Ai giữ `SYNC_TOKEN` có thể đổi nơi Worker chuyển tiếp, nên **giữ bí mật `SYNC_TOKEN`** như một khóa quản trị.
- Chỉ dùng được cho Windows x64 và Linux (x64/arm64) với tải tự động; hệ khác đặt `AZ_CLOUDFLARED`.

## 6. Danh sách kiểm trên VPS thật trước khi dùng

- [ ] `quick-tunnel.ps1 -WorkerUrl ...` chạy được, `-Show` in địa chỉ `https://....trycloudflare.com`.
- [ ] Mở `https://<worker>/api/health` từ điện thoại (4G) thấy `ok`, header `X-AZ-Served-By: vps`.
- [ ] Khởi động lại VPS, không đăng nhập RDP: sau 1-2 phút địa chỉ Worker vẫn dùng được, `-Show` ra địa chỉ **khác** trước.
- [ ] Task Manager chỉ có **một** `cloudflared.exe` của Server sau nhiều lần khởi động lại (không tích tụ tiến trình sót).
- [ ] Gateway của User tự nối lại và tracking tiếp sau khi VPS reset.
- [ ] Bật Whitelist: IP lạ qua Worker nhận 403 kèm đúng IP; IP trong danh sách vào được.
- [ ] Theo dõi mức request Worker trong Cloudflare Dashboard sau vài ngày.

## 7. Tệp liên quan

| Đường dẫn | Việc |
|---|---|
| `Server/src/tunnel.ts` | Chạy `cloudflared`, đọc địa chỉ, tự chạy lại, tự kiểm tra, dọn tiến trình sót |
| `Server/src/sync-agent.ts` | Gửi địa chỉ tunnel kèm nhịp sống, thử lại nhanh khi Worker chưa nhận |
| `Server/src/edge-ip.ts`, `Server/src/http.ts` | Kiểm chữ ký, tin IP thật do Worker chuyển |
| `BE/src/edge/vps-origin.ts` | Worker nhớ địa chỉ VPS báo lên (D1, đệm 10 giây) |
| `BE/src/edge/edge-router.ts`, `edge-sign.ts` | Chuyển tiếp tới địa chỉ hiện tại, ký IP thật |
| `BE/src/routes/sync.ts` | `/api/sync/heartbeat` nhận `tunnelUrl` |
| `Shared/src/edge-auth.ts` | Tên header, thông điệp ký, kiểm địa chỉ tunnel |
| `Server/scripts/quick-tunnel.ps1` | Bật/tắt/xem địa chỉ |
