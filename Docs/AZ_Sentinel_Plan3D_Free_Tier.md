# AZ Sentinel — Plan 3D: Tối ưu gói free Cloudflare và bỏ giới hạn 12 terminal

> Bản v0.1 · 21/10/2026 · Bổ sung cho Plan 3B và 3C, không thay đổi giao thức EA ↔ Gateway.
> **Trạng thái:** đã có mã và test xanh (Shared 61, Gateway 88, BE 153, FE 55). Chưa đo trên Cloudflare thật; các con số ngân sách bên dưới là ước tính từ nhịp trong mã (mục 5).

> **Đã thay thế (Plan 4, 22/10/2026):** khóa chung `GW_CONNECT_TOKEN` (P3D-02 và mục 7 bên dưới) không còn. Gateway nối bằng token cá nhân `azt_...` do quản trị viên cấp, xem `AZ_Sentinel_Gateway_Token.md`. Phần còn lại của Plan 3D vẫn đúng.

## 1. Mục tiêu

1. Giữ nguyên trải nghiệm: danh sách `/links` cập nhật mỗi giây, trang `/links/:id` theo tick.
2. Cả ngày không ai đăng nhập thì gần như không có request nào đi lên Cloudflare (mục 4 nói rõ "gần như").
3. Một Gateway chạy được nhiều hơn 12 terminal.
4. Không vượt hạn mức free ngay cả khi có người xem liên tục 24 giờ.

## 2. Hạn mức Cloudflare hiện hành (tra 21/10/2026)

| Mục | Gói free |
|---|---|
| Durable Object, thời gian chạy | 13.000 GB-s/ngày; mỗi giây chạy tính theo 128 MB cố định |
| Tin WebSocket đến hub | tính 20 tin = 1 request; tin đi và ping giao thức miễn phí |
| Worker | 100.000 request/ngày (mỗi lần nâng cấp WebSocket và mỗi lần web gọi API là 1) |
| D1 | 100.000 dòng ghi/ngày, 5.000.000 dòng đọc/ngày; mỗi index thêm một dòng ghi |
| Ngủ đông của hub | cần dùng Hibernation API và 10 giây không có sự kiện nào |
| Reset hạn mức | 00:00 UTC, tức 07:00 giờ Việt Nam |

**Hệ quả quan trọng:** một hub thức cả ngày tốn tối đa 86.400 giây × 0,125 GB = 10.800 GB-s, thấp hơn 13.000. Vì dự án dùng đúng một hub (`HUB_NAME = 'global'`), thời gian chạy không thể vượt hạn mức free. **Không được tách mỗi Gateway một Durable Object**, vì mỗi object thức đều tính riêng. Mức dư 2.200 GB-s là toàn bộ chỗ trống.

## 3. Rà soát: những gì mã đã làm đúng (không đổi)

| Điểm | Vị trí |
|---|---|
| Dùng Hibernation API (`ctx.acceptWebSocket`), trạng thái viewer nằm ở `serializeAttachment` | `BE/src/live/live-hub.ts` |
| Hub không có `setInterval`, alarm hay fetch treo; dọn viewer chết theo kiểu lười (`aliveConns`) | `live-hub.ts` |
| Ping `ping`/`pong` của Gateway do `setWebSocketAutoResponse` trả, không đánh thức hub | `live-hub.ts`, `Gateway/src/cloud.ts` |
| Gateway không gửi mẫu nào khi `watch` rỗng; EA ↔ Gateway chạy cục bộ | `Gateway/src/gateway.ts` |
| Xem danh sách: 1 tin/giây gộp mọi terminal của VPS; xem riêng một liên kết: 250 ms | `GW.defaultPushSec`, `GW.fastPushMs` |
| Web đóng WebSocket sau 10 giây tab ẩn, tự tạm dừng sau 10 phút không thao tác, backoff khi nối lại | `FE/.../useLiveLease.ts` |
| Xác thực viewer ở Worker trước khi gọi hub; kiểm `Origin` | `BE/src/live/routes/live-ws.ts` |
| Ghi D1 nến M5 và `link_state` chỉ khi có người xem, `link_state` tối đa 1 lần/300 giây | `live-hub.ts`, `gw-service.ts` |
| Không có cron trigger trong `wrangler.jsonc` | `BE/wrangler.jsonc` |

## 4. Thay đổi trong Plan 3D

### P3D-01. Danh sách terminal chuyển vào storage của hub, nâng giới hạn 12 lên 64

Trước đây danh sách terminal nằm trong `serializeAttachment` (tối đa 2 KB), nên mỗi kết nối Gateway chỉ giữ được 12 terminal; terminal thứ 13 trở đi bị `reject 429` và không được tracking. Giờ attachment chỉ giữ `connId`, `openedAt`, `lastBeatAt`, `hello`, `vps`. Danh sách terminal nằm ở storage SQLite của hub, khóa `gw:<connId>`, nạp lười vào bộ nhớ sau khi hub ngủ đông.

- Ghi storage chỉ khi `bind` hoặc khi terminal đổi online/offline: vài dòng mỗi ngày, không ghi theo tick.
- Khi Gateway đóng, khóa bị xóa; khi hub khởi động lại, khóa mồ côi bị dọn trong constructor.
- `MAX_GW_TERMS` = 64 (chặn an toàn), giới hạn một tin Gateway tăng từ 512 KB lên 2 MiB (hạn mức WebSocket của Cloudflare là 32 MiB).
- Cách tạm "3 Gateway mỗi cái 12 terminal" không còn cần thiết.

### P3D-02. Token mức kết nối cho Gateway

Trước đây `/api/gw/ws` không có xác thực mức kết nối, nên bất kỳ ai gọi URL (không kèm `Origin`) đều đánh thức được hub và tốn request Durable Object. Giờ Worker kiểm `Authorization: Bearer <GW_CONNECT_TOKEN>` **trước** khi gọi hub:

| Tình huống | Kết quả |
|---|---|
| Đã đặt token, thiếu hoặc sai | 401, không tới hub |
| Đúng token | 101 như cũ |
| Chưa đặt token, không chạy dev | 503 (an toàn mặc định) |
| Chưa đặt token, chạy dev (`DEV_LINKS_API=1`) | cho qua như trước |

Token so sánh bằng băm SHA-256. Gateway đọc từ `AZ_GW_TOKEN` hoặc `cloudToken` trong `config.json`.

### P3D-03. Không ai xem thì giữ `event` ở Gateway

Trước đây mỗi sự kiện lệnh đều đi lên cloud ngay, kể cả khi không ai đăng nhập, mỗi cái là một tin vào hub và vài dòng ghi D1. Giờ khi `watch` rỗng:

- `bind` và `state` (đổi online/offline) vẫn đi ngay. Lý do: hub cần biết terminal để tính `watch`, và danh sách web lấy trạng thái online từ hub (`onlineLinkIds`); giữ `state` sẽ làm lần mở web đầu tiên thấy "offline" sai. `state` chỉ đổi vài chục lần mỗi ngày nên chi phí không đáng kể.
- `event` (lệnh vào/ra) chờ ở Gateway; hàng đợi vẫn ghi ra `queue.json` nên sống sót khi Gateway khởi động lại.
- Đẩy gộp khi: có người bắt đầu xem (hub gửi `watch` khác rỗng), hoặc đủ `idleFlushSec` (mặc định 1800 giây), hoặc hàng đợi đạt `GW.idleFlushQueue` (100 lô).
- `idleFlushSec = 0` quay về hành vi cũ (gửi ngay).

Đánh đổi: lịch sử lệnh trong D1 có thể trễ tới 30 phút khi không ai xem. Khi có người mở web thì dữ liệu được đẩy ngay.

### P3D-04. Bỏ mẫu trùng, giữ nhịp sống 5 giây

EA gửi mẫu mỗi giây kể cả khi thị trường đóng (không có tick). Gateway giờ so giá trị với lần đẩy trước (`eq`, `bal`, `fl`, `ml`, và lãi/lỗ từng lệnh khi xem riêng). Không đổi thì không đẩy, trừ một mẫu giữ sống mỗi `GW.keepAliveMs` = 5.000 ms. Con số 5 giây phải nhỏ hơn `LIVE.staleSec` (10 giây) để FE không hạ cờ Live nhầm. Có giá trị mới thì đi ngay ở nhịp kế tiếp; người xem mới (tập `watch` đổi) luôn nhận mẫu đầu ngay.

Tác dụng chính là giảm request vào hub lúc thị trường đóng. Thời gian chạy không giảm vì khoảng cách 5 giây vẫn nhỏ hơn 10 giây ngủ đông.

### Đã cân nhắc và không làm

| Ý tưởng | Lý do không làm |
|---|---|
| Đổi ping văn bản sang ping giao thức (`ws.ping()`) | Hub phát hiện Gateway chết bằng mốc auto-response (`getWebSocketAutoResponseTimestamp`); ping giao thức không chắc cập nhật mốc này. Ping văn bản giữ nguyên: tối đa 8.640 tin/ngày cho 3 Gateway, nhiều nhất 432 request quy đổi (tài liệu Cloudflare không nói rõ auto-response có tính request hay không). |
| Bộ giới hạn ngân sách thời gian chạy theo ngày | Một hub không thể vượt 10.800 GB-s (mục 2), nên không có gì để giới hạn. |
| Nhịp thích ứng theo tab focus | Web đã đóng WebSocket sau 10 giây tab ẩn và tạm dừng sau 10 phút không thao tác. |
| Giảm nhịp 1 giây xuống 5 giây | Không giảm thời gian chạy (hub vẫn không ngủ), chỉ giảm request vốn đã thấp. |

## 5. Ngân sách sau Plan 3D (ước tính từ nhịp trong mã, chưa đo)

Giả định: 3 Gateway, 30 terminal, một hub.

| Tình huống (24 giờ) | Tin vào hub | Request DO quy đổi | Thời gian chạy hub |
|---|---|---|---|
| Không ai xem | khoảng 8.640 ping (auto-response) + tối đa 48 lần đẩy gộp mỗi Gateway + vài chục `state` | dưới 600 | vài trăm GB-s (mỗi lần thức khoảng 11 giây) |
| Xem danh sách, thị trường mở | 259.200 | 12.960 | tối đa 10.800 GB-s |
| Xem danh sách, thị trường đóng | khoảng 51.840 (giữ sống mỗi 5 giây) | khoảng 2.600 | tối đa 10.800 GB-s |
| Xem riêng một liên kết ở mỗi Gateway (250 ms) | 1.036.800 | 51.840 | tối đa 10.800 GB-s |

Tất cả dưới 100.000 request/ngày và dưới 13.000 GB-s/ngày. Dòng ghi D1 (ước tính cũ 17.000 đến 35.000/ngày) không đổi khi có người xem và giảm khi không ai xem.

## 6. Cả ngày không ai đăng nhập: còn lại gì

| Thứ còn đi lên Cloudflare | Mức |
|---|---|
| Ping `ping` mỗi 30 giây của mỗi Gateway | auto-response, không đánh thức hub, không tính thời gian chạy |
| `hello` và `bind` khi Gateway nối hoặc nối lại | 1 request Worker + 1 request hub + vài lần đọc D1 mỗi lần nối |
| `state` khi terminal đổi online/offline | vài chục tin/ngày cho cả hệ thống |
| Đẩy gộp `event` | tối đa 48 lần/ngày/Gateway, hoặc sớm hơn khi hàng đợi đạt 100 lô |
| Bot hoặc request lạ vào `/api/gw/ws` | 1 request Worker, bị chặn ở Worker, không tới hub (P3D-02) |

Đây là "gần như không", không phải 0 tuyệt đối: việc giữ kết nối và nối lại sau khi Cloudflare reset object (deploy, runtime) vẫn tốn vài request. Nếu muốn về 0 hơn nữa, cách duy nhất là Gateway đóng WebSocket khi không ai xem, nhưng khi đó cloud không có kênh để báo "có người vừa mở web", nên không làm.

## 7. Vận hành

1. ~~`wrangler secret put GW_CONNECT_TOKEN`~~ (đã bỏ từ Plan 4). Nếu Worker đã deploy còn secret này: `wrangler secret delete GW_CONNECT_TOKEN`.
2. Mỗi người một token cá nhân `azt_...` do quản trị viên cấp; nhập vào bộ cài Gateway (hoặc `AZ_GW_TOKEN`, `cloudToken`).
3. Tùy chọn: `AZ_GW_IDLE_FLUSH_SEC` (mặc định 1800; 0 = gửi ngay).
4. (Lúc viết Plan 3D) không cần migration D1 mới; từ Plan 4 cần migration `0004` (bảng `gw_tokens`), `pnpm db:migrate:remote` trong workflow deploy đã chạy sẵn. Hub dùng storage SQLite của Durable Object (gói free bắt buộc SQLite-backed, đã đúng theo `new_sqlite_classes`).

## 8. Cách đo sau khi deploy

1. Cloudflare dashboard, mục Durable Objects, xem Requests và Duration của `LiveHub` trong một ngày không ai mở web: Requests nên dưới vài trăm, Duration nên dưới vài trăm GB-s.
2. Mở `/links` một giờ rồi so với bảng mục 5 (khoảng 540 request/giờ khi thị trường mở).
3. `wrangler tail` khi Gateway nối lại để thấy 401 nếu token sai.
4. Điền số đo thật vào `spike-results.md`; phần chưa biết: auto-response có tính request hay không, và kích thước `batch` thực tế với 30 terminal.

## 9. Rủi ro và quyết định cần chốt

| Mã | Nội dung | Đề xuất |
|---|---|---|
| Q-D1 | `idleFlushSec` mặc định 1800 giây: lịch sử lệnh trong D1 trễ tới 30 phút khi không ai xem (`state` không bị giữ) | Giữ 1800; đặt 0 nếu cần ghi ngay |
| Q-D2 | Gateway hỏng đĩa hoặc mất `queue.json` trước khi đẩy gộp thì mất tối đa 30 phút sự kiện chưa đẩy | Chấp nhận ở MVP; hàng đợi đã ghi file |
| Q-D3 | Token dùng chung cho mọi Gateway, lộ một VPS là phải đổi cho tất cả | Chấp nhận ở MVP; Part 2 làm ghép nối VPS bằng mã (Q3 của Plan 3C) |
| R-D1 | `ctx.storage.kv` ghi một dòng mỗi lần `bind` và mỗi lần đổi online/offline; 30 terminal nối lại cùng lúc là 30 dòng | Không đáng kể so với 100.000 dòng/ngày |
