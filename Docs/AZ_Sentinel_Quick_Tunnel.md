# Quick Tunnel tự theo (Plan 3G): không cần tên miền, VPS reset vẫn vào được

> v0.3 · 23/10/2026 (Server 0.2.2: tự chọn cloudflared hợp Windows cũ) · v0.2 (Plan 3H: Gateway tự tìm tunnel và nối thẳng) · **Chưa thử trên Windows/Cloudflare thật.** Phần Node/TypeScript đã có test và đã chạy thử với `cloudflared` giả; việc tải `cloudflared.exe`, tác vụ "AZ Server" và Worker thật cần chạy thử trên VPS (mục 6).

## 1. Vấn đề và cách giải

Quick Tunnel (`*.trycloudflare.com`) miễn phí, không cần tên miền, nhưng **địa chỉ đổi mỗi lần `cloudflared` chạy lại** (VPS reset, Server khởi động lại). Cách giải (Plan 3H): **Worker Cloudflare chỉ làm hai việc nhẹ**: (1) là máy chủ dự phòng khi VPS sập, (2) là **danh bạ tunnel**: VPS báo địa chỉ tunnel mới cho Worker, Gateway hỏi Worker "tunnel hiện tại là gì?" rồi **nối THẲNG vào tunnel**. Lưu lượng thật (WebSocket Gateway, dữ liệu live) không đi qua Worker nên **không tốn hạn mức request**.

```
Gateway ──(1 request nhỏ: GET /api/gw/tunnel, chỉ lúc khởi động / mất kết nối)──► Worker (danh bạ + dự phòng)
Gateway ══(WebSocket, nối THẲNG)══► xxxx.trycloudflare.com ──► VPS (Server)

VPS khởi động ─► Server chạy cloudflared ─► đọc địa chỉ mới ─► POST /api/sync/heartbeat ─► Worker nhớ địa chỉ mới
```

Gateway chỉ cần **mã kết nối** (địa chỉ Worker + token), không cần biết địa chỉ tunnel và không phải nhập lại khi nó đổi. Mã kết nối mang địa chỉ Worker (cố định); Server tự lấy `AZ_CLOUD_URL` làm `AZ_PUBLIC_URL` khi bật Quick Tunnel.

> Worker vẫn có thể chuyển tiếp trình duyệt/Gateway cũ sang VPS như Plan 3E (mỗi request tính vào hạn mức). Gateway mới không dùng đường này.

## 2. Hành vi khi VPS reset

1. VPS sập: kết nối Gateway tới tunnel rớt. Gateway **hỏi danh bạ ngay**; chưa có tunnel mới thì sau 2 lần nối hỏng chuyển sang **Worker dự phòng** (Cloudflare hub, vẫn nhận dữ liệu). Mã kết nối Quick Tunnel chỉ mang một địa chỉ (Worker, vì địa chỉ dự phòng trùng địa chỉ chính nên bị bỏ), nên khi đã học được tunnel từ danh bạ, **chính địa chỉ Worker là dự phòng**: tunnel chết mà danh bạ còn trỏ địa chỉ cũ thì Gateway vẫn xuống Worker, không kẹt ở tunnel chết.
2. VPS lên lại: tác vụ "AZ Server" tự chạy lúc khởi động máy (và `run-server.cmd` tự bật lại Server nếu nó thoát), Server dọn `cloudflared` sót, mở Quick Tunnel mới, đọc địa chỉ (thường 5-15 giây).
3. Server báo địa chỉ mới cho Worker ngay (thử lại 5 giây, giãn dần, tối đa 12 lần), không chờ nhịp sống 2 phút. Worker ghi D1 và dùng ngay trong isolate đó; isolate khác thấy sau tối đa 10 giây.
4. Gateway đang ở dự phòng **hỏi danh bạ mỗi 15 giây** (2 phút đầu, sau đó 60 giây) rồi thử nối tunnel; được thì tự về, không cần thao tác. Gateway đang nối thẳng mà tunnel đổi thì hỏi danh bạ ngay và nối sang tunnel mới, không phải rơi xuống dự phòng.

Khoảng gián đoạn ≈ thời gian VPS khởi động + 15-30 giây tunnel + tối đa ~15 giây Gateway hỏi lại. Trong lúc đó dữ liệu vẫn vào bản dự phòng.

**Chi phí request Worker:** Gateway ổn định = 0 request (chỉ 1 request lúc khởi động). Khi VPS sập: ≤ 8 request trong 2 phút đầu rồi 1 request/phút cho mỗi Gateway; VPS sập cả ngày với 10 Gateway ≈ 15.000 request, dưới hạn 100.000/ngày của gói free. Cộng nhịp sống VPS ≈ 720 request/ngày.

Server còn tự kiểm tra tunnel mỗi 60 giây (gọi `/api/health` qua chính địa chỉ tunnel, bỏ qua 30 giây đầu); hỏng 3 lần liên tiếp thì tự khởi động lại `cloudflared` và báo địa chỉ mới.

### 2.1. Giao diện web khi VPS reset (Plan 3I)

Worker API phục vụ **luôn giao diện** (static assets, `/api/*` vẫn chạy mã Worker) nên địa chỉ Worker là bản dự phòng đầy đủ: cùng origin với API, đăng nhập và WebSocket chạy được. Địa chỉ Worker là địa chỉ **cố định** để đánh dấu trang (bookmark) hoặc gửi cho người dùng; địa chỉ tunnel đổi mỗi lần.

1. Người dùng đang mở web bằng địa chỉ tunnel, VPS sập: lời gọi API lỗi mạng, banner đỏ báo mất kết nối và đếm ngược 9 giây (dò lại mỗi 3 giây, nên mạng chớp thì không chuyển).
2. Hết thời gian chờ: trang kiểm bản dự phòng có trả lời không, có thì tự chuyển sang địa chỉ Worker, **giữ nguyên trang đang xem**. Bản dự phòng chưa trả lời thì báo và dò tiếp. Địa chỉ dự phòng lấy từ `fallbackUrl` của `/api/server-info` (nhớ trong trình duyệt để dùng được cả khi chưa kịp gọi); VPS mặc định đặt bằng địa chỉ Worker (`AZ_CLOUD_URL`), không phải điền `AZ_FALLBACK_URL`.
3. Ở bản dự phòng: phiên đăng nhập là của origin Worker nên **người dùng đăng nhập lại một lần** (tài khoản đã đồng bộ sang Cloudflare). Chế độ dự phòng chỉ cho xem, thao tác ghi liên kết/token bị khóa (như Plan 3E).
4. VPS lên lại: Worker chuyển tiếp `/api/*` về VPS (tính request Worker) nên trang tự hết chế độ dự phòng, không cần làm gì. Muốn bỏ chi phí request này, banner hiện nút **Mở máy chủ chính** trỏ thẳng tunnel mới (poll 10 giây khi đang dự phòng); không tự ép chuyển để không làm mất việc đang làm, vì phiên của tunnel là phiên riêng.

Không cứu được: trình duyệt **tải mới** một địa chỉ tunnel đã chết (chỉ thấy trang lỗi của trình duyệt vì không còn máy chủ nào trả lời). Vì vậy hãy phát địa chỉ Worker cho người dùng làm địa chỉ chính.

### 2.2. Worker chuyển hướng sang tunnel, heartbeat theo người truy cập (Plan 3J)

Worker không còn là máy chủ giao diện chính mà là **người đi tìm tunnel**:

1. Người dùng mở địa chỉ Worker. Worker chạy mã cho lượt tải trang (tệp tĩnh `/assets/*`, favicon không tính), lấy địa chỉ Quick Tunnel mà VPS đã báo, **dò** `/api/health` của tunnel (nhớ tạm 10 giây trong isolate) rồi trả **302** sang `https://<tunnel>/<đường dẫn cũ>`. Từ đó trình duyệt nói chuyện thẳng với VPS: Worker chỉ tốn **1 request cho mỗi lượt vào**.
2. Tunnel chết, chưa biết tunnel hoặc dò lỗi: Worker tự phục vụ giao diện dự phòng (binding `ASSETS`), giống Plan 3I. Địa chỉ chết không bao giờ bị trả cho trình duyệt.
3. Tunnel đổi địa chỉ: VPS báo lại ngay (mục 2) nên lượt vào sau tự trỏ đúng.
4. `?az_stay=1` trên địa chỉ Worker buộc ở lại bản dự phòng (giao diện tự dùng khi chuyển từ tunnel chết sang Worker, rồi tự bỏ tham số khỏi thanh địa chỉ). Biến Worker `PAGE_REDIRECT=0` tắt hẳn chuyển hướng; `PAGE_REDIRECT=1` cho chuyển cả sang `VPS_ORIGIN` đặt tay (mặc định chỉ chuyển sang Quick Tunnel).
5. **Phiên đăng nhập là của origin tunnel**: mỗi lần tunnel đổi địa chỉ (VPS reset), người dùng phải đăng nhập lại một lần. Muốn tránh hãy dùng tunnel có tên + tên miền (Plan 3E).

**Nhịp sống và đồng bộ chỉ chạy khi có người truy cập** (`AZ_SYNC_ON_DEMAND`, mặc định bật; đặt `0` để chạy liên tục như trước). "Có người" = có request của giao diện tới VPS trong 10 phút gần nhất (`FAILOVER.visitorIdleSec`): trang, API người xem, WebSocket live; Gateway, EA, `/api/health`, đường đồng bộ không tính.

- Có người đầu tiên: VPS báo nhịp sống và xả hàng đợi ngay; trong lúc có người thì chạy theo nhịp cũ (xả 15 giây, nhịp sống 4 phút, kéo 1 giờ).
- Hết người: xả nốt hàng đợi **một lần** rồi nghỉ; thay đổi sau đó nằm trong hàng đợi (gộp theo dòng) và được đẩy khi có người vào lại.
- Vẫn chạy khi không có người: lần khởi động Server (nhận dữ liệu ban đầu) và báo địa chỉ tunnel mới (hiếm, cần để chuyển hướng đúng).
- Đánh đổi: nếu VPS sập lúc không ai dùng, bản dự phòng chỉ có dữ liệu tới lần đồng bộ cuối.

## 3. Cài đặt (làm một lần)

**Trên Cloudflare** (Worker của dự án này, `az-sentinel-api`, và web `az-sentinel-web`, deploy bằng tag deploy như `AZ_Sentinel_CI_Tags_And_Gateway_Power.md`):

1. Tạo `SYNC_TOKEN`: một chuỗi ngẫu nhiên >= 32 ký tự. `wrangler secret put SYNC_TOKEN` (cho Worker API).
2. **Không đặt `VPS_ORIGIN`** (Worker tự học địa chỉ từ VPS). Nếu đã đặt thì địa chỉ VPS báo lên vẫn thắng; VPS báo "không dùng Quick Tunnel" thì quay về `VPS_ORIGIN`.
3. Ghi địa chỉ Worker (ví dụ `https://az-sentinel-api.<tài-khoản>.workers.dev`) để dùng ở bước dưới.

**Trên VPS, cách nhanh nhất: dùng bộ cài Server.** Điền địa chỉ Worker API và `SYNC_TOKEN` (>= 32 ký tự, trùng Worker), **để trống** "URL công khai" và "Token Cloudflare Tunnel": bộ cài tự ghi `AZ_QUICK_TUNNEL=1`. Xong, không cần làm gì thêm.

Đã cài từ trước thì PowerShell Administrator, trong thư mục cài:

```powershell
.\quick-tunnel.ps1            # lấy AZ_CLOUD_URL trong server.env; thêm -WorkerUrl https://... để đổi
.\quick-tunnel.ps1 -Show      # sau 30-60 giây: xem địa chỉ tunnel hiện tại
```

Script đặt `AZ_QUICK_TUNNEL=1` (và `AZ_PUBLIC_URL=<địa chỉ Worker>`) trong `server.env` rồi khởi động lại "AZ Server". Làm tay cũng được. Tắt: `.\quick-tunnel.ps1 -Off`.

- `AZ_PUBLIC_URL` để trống thì Server tự lấy địa chỉ Worker (`AZ_CLOUD_URL`). Nếu tự đặt thì phải là **địa chỉ Worker** (cố định), không phải địa chỉ `trycloudflare.com`, vì đó là địa chỉ đưa vào mã kết nối Gateway.
- `cloudflared.exe` tự tải về `C:\ProgramData\AZSentinelServer` lần chạy đầu (cần VPS ra được `github.com`). Đặt `AZ_CLOUDFLARED` nếu muốn dùng tệp có sẵn. Tệp `tunnel-url.txt` cùng thư mục ghi địa chỉ hiện tại.
- **Windows cũ (Windows 8.1 / Server 2012 R2, Server 2008 R2):** bản `cloudflared` mới nhất (Go 1.21 trở đi) không chạy được ở đó (`not a valid application for this OS platform`, log Server ghi `spawn EFTYPE` lặp lại). Từ Server 0.2.2, máy Windows trước 10 tự tải bản **2023.10.0** (Go 1.20, bản cuối còn hỗ trợ). Server cũng tự kiểm `cloudflared --version` khi khởi động: tệp có sẵn mà không chạy được thì xóa và tải lại đúng bản (tệp do `AZ_CLOUDFLARED` chỉ định thì chỉ báo lỗi, không xóa). Nâng cấp từ bản cũ không cần làm gì thêm; muốn thay tay thì tải `https://github.com/cloudflare/cloudflared/releases/download/2023.10.0/cloudflared-windows-amd64.exe` vào `C:\ProgramData\AZSentinelServer\cloudflared.exe`.
- Bản 2023.10.0 là bản cũ: Cloudflare có thể ngừng hỗ trợ giao thức của nó trong tương lai. Khi đó hãy nâng VPS lên Windows Server 2016 trở lên (dùng được bản mới nhất).
- Cài đè bằng bộ cài với `/RECONFIGURE=1` sẽ ghi lại `server.env` và làm mất hai dòng này (xem `AZ_Sentinel_Server_Installer.md`): chạy lại `quick-tunnel.ps1`.

**Cấp Gateway:** Start menu > Quản lý token Gateway > `token issue ...`; gửi **mã kết nối** cho người dùng (đã mang địa chỉ Worker). Gateway tự hỏi Worker tìm tunnel hiện tại. Nếu nhập tay: Cloud URL = `wss://<worker>/api/gw/ws`, ô dự phòng cũng là địa chỉ Worker (đó là nơi Gateway hỏi danh bạ).

## 4. Whitelist IP khi đi qua Worker

Qua Worker, VPS chỉ thấy IP của Cloudflare. Worker chuyển IP thật của người dùng bằng ba header `X-AZ-Client-IP`, `X-AZ-Edge-Ts`, `X-AZ-Edge-Sig`; chữ ký là HMAC-SHA256 (khóa = `SYNC_TOKEN`) trên `IP|mốc giờ`.

- VPS **chỉ tin IP trong header khi chữ ký đúng** và mốc giờ lệch không quá 5 phút. Client tự đặt header thì bị bỏ qua và gỡ khỏi request; mạo danh IP được phép không qua mặt được whitelist.
- Vì vậy Whitelist (Plan 3F) hoạt động đúng cả khi đi qua Worker, không cần cấu hình thêm. IP lạ vẫn nhận 403 kèm đúng IP của họ; nút "Thêm IP của tôi" ghi đúng IP thật.
- Đồng hồ VPS Windows phải đúng (tự đồng bộ giờ). Lệch quá 5 phút thì mọi người dùng qua Worker bị coi là IP của Cloudflare.
- Whitelist chỉ áp ở VPS, không áp ở bản dự phòng Cloudflare (như cũ).

## 5. Giới hạn và rủi ro

- **Trình duyệt vẫn đi qua Worker nếu mở web bằng địa chỉ Worker** (mỗi request tính vào hạn mức free). Lưu lượng Gateway thì không (nối thẳng tunnel). Nếu cần giảm nữa, cho người dùng mở web bằng địa chỉ tunnel hiện tại (`-Show`) hoặc dùng tunnel có tên + tên miền (Plan 3E).
- **Tunnel đi thẳng nên IP Gateway/người dùng là IP thật** (cloudflared gửi `CF-Connecting-IP`); Whitelist IP (Plan 3F) áp dụng như bình thường, nhớ thêm IP của các Gateway nếu bật Whitelist.
- **Quick Tunnel do Cloudflare ghi rõ là chỉ để thử nghiệm và phát triển, không cam kết SLA hay thời gian hoạt động** (tài liệu `developers.cloudflare.com/tunnel/get-started/quick-tunnels/`). Muốn ổn định lâu dài hãy dùng tunnel có tên và tên miền (Plan 3E).
- Mỗi Quick Tunnel nhận tối đa **200 request đồng thời**, vượt thì trả HTTP 429. Quick Tunnel **không hỗ trợ SSE**, nhưng dự án này không dùng SSE (Gateway và trang live dùng WebSocket; `pnpm dev:public` của repo cũng cho Gateway nối WebSocket qua Quick Tunnel). Việc WebSocket Gateway nối thẳng Quick Tunnel trên VPS thật vẫn cần thử (mục 6).
- Quick Tunnel không chạy đúng nếu thư mục `.cloudflared` của tài khoản chạy Server (SYSTEM) có sẵn `config.yaml` (do tunnel có tên cấu hình tay để lại). Server cài bằng `setup-tunnel.ps1` (token) không tạo tệp này; nếu từng cấu hình tay thì xóa/đổi tên tệp đó.
- Có khoảng gián đoạn ngắn mỗi lần reset (mục 2). Gateway nối vào Worker trong lúc dự phòng vẫn được nhận (token đã đồng bộ sang D1).
- Địa chỉ báo lên phải là `https`, không IP thô/`localhost`/cổng lạ/tài khoản trong URL. Ai giữ `SYNC_TOKEN` có thể đổi nơi Worker chuyển tiếp, nên **giữ bí mật `SYNC_TOKEN`** như một khóa quản trị.
- Chỉ dùng được cho Windows x64 và Linux (x64/arm64) với tải tự động; hệ khác đặt `AZ_CLOUDFLARED`.

## 6. Danh sách kiểm trên VPS thật trước khi dùng

- [ ] `quick-tunnel.ps1 -WorkerUrl ...` chạy được, `-Show` in địa chỉ `https://....trycloudflare.com`.
- [ ] Mở `https://<worker>/api/health` từ điện thoại (4G) thấy `ok`, header `X-AZ-Served-By: vps`.
- [ ] Khởi động lại VPS, không đăng nhập RDP: sau 1-2 phút địa chỉ Worker vẫn dùng được, `-Show` ra địa chỉ **khác** trước.
- [ ] Task Manager chỉ có **một** `cloudflared.exe` của Server sau nhiều lần khởi động lại (không tích tụ tiến trình sót).
- [ ] Gateway của User tự nối lại và tracking tiếp sau khi VPS reset (log Gateway có dòng `danh bạ báo tunnel mới`).
- [ ] Trong Cloudflare Dashboard, request Worker khi Gateway ổn định gần như chỉ còn nhịp sống VPS (~720/ngày), không tăng theo số Gateway.
- [ ] Tắt hẳn VPS 3 phút rồi bật lại: Gateway sang dự phòng rồi tự về tunnel mới, không thao tác.
- [ ] Mở web bằng địa chỉ tunnel, đăng nhập, rồi tắt VPS: sau khoảng 10 giây trang tự sang địa chỉ Worker (đúng trang đang xem), đăng nhập lại được, banner vàng báo dự phòng.
- [ ] Bật VPS lại: banner có nút **Mở máy chủ chính** với địa chỉ tunnel mới, bấm vào mở đúng trang.
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
| `FE/src/features/server/FailoverWatcher.tsx`, `FailoverBanner.tsx`, `FE/src/lib/failover.ts` | Giao diện dò lại, đếm ngược, tự chuyển sang dự phòng, nút mở tunnel mới |
| `BE/wrangler.jsonc` (`assets`) | Worker API phục vụ giao diện, `/api/*` chạy mã Worker |
| `BE/src/routes/sync.ts` | `/api/sync/heartbeat` nhận `tunnelUrl` |
| `BE/src/live/routes/gw-ws.ts` | `GET /api/gw/tunnel`: danh bạ tunnel cho Gateway (cần token Gateway, Worker tự trả lời) |
| `Gateway/src/cloud.ts` | Hỏi danh bạ khi khởi động/mất kết nối/đang dự phòng, nối thẳng tunnel; coi lỗi nối là kết thúc (Node không luôn bắn `close`) |
| `Shared/src/tunnel-directory.ts` | Đường dẫn và kiểu trả lời của danh bạ |
| `Shared/src/edge-auth.ts` | Tên header, thông điệp ký, kiểm địa chỉ tunnel |
| `Server/scripts/quick-tunnel.ps1` | Bật/tắt/xem địa chỉ |
| `BE/src/edge/page-router.ts` | Lượt tải trang: dò tunnel, 302 sang tunnel hoặc phục vụ giao diện dự phòng (Plan 3J) |
| `Server/src/activity.ts`, `Server/src/sync-agent.ts` (`touch`, `hasVisitors`) | Chỉ nhịp sống/đồng bộ khi có người truy cập |
| `FE/public/favicon.*`, `FE/index.html` | Logo trên tab trình duyệt |

#### Mã thiết bị đi theo người dùng qua các tunnel (Plan 3K)
Cookie thiết bị gắn theo tên miền nên tunnel đổi địa chỉ thì trình duyệt thành "thiết bị mới" (phải duyệt lại ở whitelist thiết bị). Worker vì vậy giữ cookie `az_dev` ở địa chỉ cố định và gắn vé mã hóa `az_dh` (hạn 60 giây, dùng một lần) vào link 302 sang tunnel; Server cấp lại cùng mã cho tunnel mới. Từ Server 0.2.10, với lượt tải trang Server **phục vụ luôn** (cookie gắn vào chính phản hồi, mã thiết bị dùng ngay cho request đó) thay vì trả thêm một 302 sang URL sạch, và giao diện tự gỡ `az_dh` khỏi thanh địa chỉ; chỉ request không phải tải trang mới còn 302. Lý do và số đo: `AZ_Sentinel_PWA.md`. Cần `SYNC_TOKEN` trùng ở Worker và Server; thiếu thì Worker chuyển hướng như cũ. Chi tiết và cách chuyển đổi một lần: `AZ_Sentinel_Whitelist_IP.md`.
