# AZ Sentinel — Plan 3C: Cổng cục bộ (Gateway) trên mỗi VPS và EA tracking trong từng terminal

> Bản v0.2 · 21/10/2026 · Thay thế phần "EA hỏi gate qua internet" của `AZ_Sentinel_Plan3B_Live_On_Demand.md`. Giữ nguyên phần viewer WebSocket, `LiveHub`, `useLiveLease` đã làm.
> **Trạng thái v0.2:** patch 05 đến 07 và 09 đến 11 (một phần) đã có mã và test xanh: schema dùng chung, Gateway (Node/TypeScript), EA `AZ_Spike.mq5` v0.2.0, `fake-cloud`, `fake-ea`. **Còn thiếu:** (patch 08 BE và patch 09 FE đã có mã, chờ manual test) thử EA trên MT5 thật (G0, A-01 đến A-07), bộ cài (12), FE (13). Xem bảng mục 11.

> **Cập nhật 21/10/2026:** tối ưu gói free của Cloudflare, bỏ giới hạn 12 terminal mỗi Gateway, thêm token mức kết nối và giữ `state`/`event` khi không ai xem: xem `AZ_Sentinel_Plan3D_Free_Tier.md`. Các chỗ bên dưới nhắc "chưa có xác thực mức VPS" hoặc ngân sách cũ đã được Plan 3D thay thế.

## 0. Vì sao đổi hướng

Plan 3B để mỗi EA tự gọi `GET /gate` qua internet mỗi 120 giây để biết "có người xem không". Điều đó tốn 21.600 request Worker và 10.800 dòng ghi D1 mỗi ngày dù không ai mở web, và trễ tối đa 120 giây mới vào live.

Thử dùng gói Python `MetaTrader5` để đọc terminal (thay cho EA) đã **thất bại** trên máy phát triển:

| Quan sát (21/10/2026) | Giá trị |
|---|---|
| Terminal | MT5 build 6230 (25/9/2026), đăng nhập Exness demo, kết nối bình thường, lệnh vẫn khớp |
| Gói Python | `MetaTrader5` 5.0.6231, Python 3.12.10 64-bit |
| Lỗi | `-10003 IPC initialize failed, Pipe server didn't answer in 60 sec`, cả có `path` lẫn không |
| Đã loại trừ | Lệch quyền (cả hai không elevated, cùng user Admin), đóng gói `.exe` (lỗi y hệt bằng Python thường), terminal chưa đăng nhập |
| Bên ngoài | Một báo cáo trên diễn đàn MQL5 (khoảng 3 tuần trước) cho lỗi tương tự với terminal build 6231, chưa có lời giải |

Chưa xác định được nguyên nhân gốc, và không cần xác định: đường đọc dữ liệu qua giao thức nội bộ của MetaQuotes có thể hỏng ở mỗi lần terminal tự cập nhật, trên hàng chục VPS cùng lúc. EA dùng API MQL5 có tài liệu nên ổn định hơn. Vì mỗi terminal vốn đã cần một EA để tracking, hướng mới là:

1. **EA tracking** trong từng terminal (mở rộng `ea/AZ_Spike.mq5`), chỉ nói chuyện với **Gateway cục bộ** qua HTTP loopback.
2. **Gateway** (một tiến trình mỗi VPS) giữ **một WebSocket** ra `LiveHub`, nhận lệnh "đang có người xem" từ hub rồi báo cho EA.
3. Trình duyệt vẫn dùng WebSocket như Plan 3B. Không còn poll nào đi qua internet.

Kiến thức rút ra từ spike, dùng cho bộ cài (mục 7):

- Mỗi bản cài MT5 có thư mục dữ liệu `%APPDATA%\MetaQuotes\Terminal\<hash>`; file `origin.txt` trong đó là **UTF-16 LE có BOM** và chứa đường dẫn cài đặt.
- Thư mục `Common` dùng chung cho mọi terminal; các thư mục hash còn lại có thể **mồ côi** (bản cài đã xóa). Chỉ coi là terminal khi có tiến trình `terminal64.exe` đang chạy từ đúng đường dẫn đó.
- Terminal chạy kiểu "copy thư mục cài" vẫn dùng thư mục dữ liệu trong AppData, không phải portable thật.
- Đường MT5 → `http://127.0.0.1:8787` đã chạy ở bản spike (ghi chú đầu Plan này: `POST /api/ea/v1/ingest 200` đều đặn mỗi 10 giây). Phải ghi số đo chính thức vào `Docs/spike-results.md` mục 6 (P1-29).

## 1. Mục tiêu và nguyên tắc

1. **Không ai xem thì không có gì đi qua internet.** Không gate poll, không heartbeat. Chỉ có kết nối WebSocket nhàn rỗi của Gateway (ping giao thức không tính phí và không đánh thức hub) và các tín hiệu hiếm (mục 4).
2. **EA chỉ nói chuyện cục bộ.** Mọi `WebRequest` của EA tới `127.0.0.1`. EA không giữ khóa Cloudflare, không biết URL cloud.
3. **Cổng cục bộ làm cầu duy nhất ra ngoài.** Một WebSocket mỗi VPS, gom mẫu của mọi terminal vào một tin mỗi nhịp.
4. **Tracking khi cần.** Hub chỉ yêu cầu mẫu của các terminal đang có người xem. Sự kiện giao dịch và đổi trạng thái luôn đi (ít, quan trọng).
5. **Ghi D1 theo sự kiện, không theo thời gian.** Không ghi nhịp sống, không ghi từng mẫu.
6. **An toàn khi hỏng.** Gateway chết, mạng chết hoặc hub chết thì EA tự về chế độ chỉ ghi nhận cục bộ trong tối đa 15 giây (dead-man switch cục bộ). Lỗi luôn làm dữ liệu ngừng chảy, không bao giờ làm chảy thêm.
7. **EndUser làm ít nhất có thể:** chạy bộ cài một lần mỗi VPS, nhập mã ghép nối, gắn EA vào một chart mỗi terminal (một lần).

## 2. Kiến trúc

```mermaid
flowchart LR
  subgraph VPS["Mỗi VPS (Windows Server)"]
    T1["Terminal 1<br/>EA tracking"] -- "HTTP 127.0.0.1" --> GW
    T2["Terminal 2<br/>EA tracking"] -- "HTTP 127.0.0.1" --> GW
    TN["Terminal N<br/>EA tracking"] -- "HTTP 127.0.0.1" --> GW
    GW["AZ Gateway<br/>(Windows Service)<br/>+ giao diện cục bộ"]
  end
  GW == "1 WebSocket<br/>bind, state, batch, event" ==> HUB["LiveHub<br/>(Durable Object)"]
  HUB -- "watch (tập terminal cần mẫu)" --> GW
  HUB -- "snapshot, samples,<br/>positions, live_state" --> FE["Trình duyệt<br/>/links"]
  FE -- "hello, hb" --> HUB
  HUB -- "ghi theo sự kiện" --> D1[("D1")]
```

| Thành phần | Trạng thái so với Plan 3B | Việc cần làm |
|---|---|---|
| FE: `useLiveLease`, nút Live, huy hiệu | Đã xong, giữ | Chỉ chỉnh chữ và thêm trạng thái `offline` (mục 8) |
| BE: `LiveHub`, `/api/live/ws`, viewer auth | Đã xong, giữ | Thêm đầu nối cho Gateway (mục 5) |
| BE: `GET /api/ea/v1/gate`, `POST /ingest` live | Đã xong | Giữ làm chế độ "direct" tạm thời, xóa sau (Q5) |
| EA: máy trạng thái gate/lease qua internet | Chưa làm | **Bỏ**, thay bằng máy trạng thái cục bộ (mục 6) |
| Gateway, giao diện cục bộ, bộ cài | Chưa có | Mới (mục 4, 7) |

## 3. Giao thức EA ↔ Gateway (HTTP loopback)

Địa chỉ mặc định `http://127.0.0.1:47800` (đổi bằng input `InpGateway`). JSON UTF-8, thời gian chờ của EA 1 giây. Gateway phải trả lời dưới 50 ms vì `WebRequest` chặn luồng EA.

| Endpoint | EA gọi khi | Nội dung chính | Phản hồi |
|---|---|---|---|
| `POST /v1/ping` | Mỗi `ping_sec` (mặc định 5, tối thiểu 2), luôn luôn | `sid`, `key`, `login`, `server`, `broker`, `ea_ver`, `mode` (demo/real), ảnh chụp tài khoản `{bal, eq, margin, fl}` | `{watch, interval_ms, lease_ms}` |
| `POST /v1/samples` | Chỉ khi `watch = true`, mỗi `interval_ms` | `sid`, `seq`, `samples` (tối đa 20, `{t, eq, bal, fl, ml}`), `positions` chỉ khi `pos_hash` đổi | như `ping` |
| `POST /v1/event` | Có **tín hiệu** (bên dưới), gửi ngay | `sid`, `seq`, `reason`, `events` (tối đa 100, đúng `tradeEventSchema` hiện có) | `{ack_seq}` |

Tín hiệu EA gửi `event` (luôn bật, bất kể có người xem):

| Tín hiệu | Nguồn trong MQL5 |
|---|---|
| Mở, đóng, sửa lệnh; nạp hoặc rút tiền | `OnTradeTransaction` |
| Mất hoặc có lại kết nối broker | thay đổi `TERMINAL_CONNECTED` (kiểm ở `OnTimer`) |
| Margin level vượt ngưỡng (`InpMarginLevelAlert`) | `OnTimer` 1 giây, chỉ khi cắt ngưỡng |
| EA khởi động hoặc tắt | `OnInit`, `OnDeinit` |

Ghi chú:

- `ping` luôn gửi, vì nó là cục bộ và gần như miễn phí. Nó thay thế gate poll và cho Gateway biết terminal còn sống.
- Vào live trễ tối đa `ping_sec` (5 giây) cộng thời gian hub đẩy `watch`. Thay cho tối đa 120 giây của Plan 3B.
- Gateway gửi lệnh bắt đầu live ngay trong phản hồi `ping` kế tiếp; EA bắt đầu lấy mẫu 1 giây và gửi `samples` theo `interval_ms`.
- Xác thực cục bộ (MVP): mỗi request mang `key` (API key của liên kết như hiện nay). Gateway chỉ lắng nghe `127.0.0.1`, không bao giờ `0.0.0.0`.
- Terminal chạy trong phiên RDP khác nhau vẫn gọi được loopback.

## 4. Giao thức Gateway ↔ Cloud (WebSocket)

Gateway mở `GET /api/gw/ws` và giữ vĩnh viễn, nối lại theo backoff 1, 2, 4... tối đa 60 giây có jitter. Gửi ping giao thức mỗi 30 giây; hub trả lời ping giao thức mà không bị đánh thức khỏi ngủ đông ([tài liệu](https://developers.cloudflare.com/durable-objects/api/websockets)).

**Gateway → Cloud**

| Tin | Khi nào | Ghi D1 |
|---|---|---|
| `hello` `{v, gw_ver, vps, os}` | Sau khi nối | Không |
| `bind` `{tid, key, login, server, mode, broker, name}` | Lần đầu thấy terminal, hoặc sau khi nối lại | Đọc D1 một lần (tra băm khóa); lần đầu của khóa thì gắn tài khoản như ingest hiện tại |
| `state` `{tid, online, snap}` | Terminal lên/xuống, hoặc broker mất/có kết nối | Chỉ khi chuyển trạng thái: cập nhật `presence` và chèn sự kiện `online`/`offline` |
| `batch` `{items:[{tid, samples, positions?, pos_hash?}]}` | Mỗi `push_sec`, **chỉ khi hub đang yêu cầu** | Theo quy tắc ghi mục 5 |
| `event` `{tid, seq, reason, events}` | Có tín hiệu | Upsert `trades` như hiện tại |

**Cloud → Gateway**

| Tin | Nội dung |
|---|---|
| `bound` / `reject` | `{tid, link_id}` hoặc `{tid, code}` (401, 403, 409 như ingest hiện tại) |
| `watch` | `{tids:[...], push_sec}`: tập terminal đang có người xem. Gửi mỗi khi tập đổi; rỗng nghĩa là ngừng gửi mẫu |
| `ack` | `{tid, seq}` cho `event` |
| `update` | `{min_ver, url, sha256}` khi bản Gateway quá cũ (mục 7) |

Kết nối chưa `hello` trong 10 giây thì bị đóng. Từ Plan 3D, Worker đòi `Authorization: Bearer <GW_CONNECT_TOKEN>` khi mở WebSocket và từ chối trước khi gọi hub; quyền dữ liệu vẫn đi qua khóa của từng liên kết trong `bind` (Q3 giữ nguyên cho phần liên kết).

## 5. Thay đổi ở BE

| Hạng mục | Nội dung |
|---|---|
| Endpoint | `GET /api/gw/ws`: nâng cấp WebSocket cho Gateway, chuyển vào cùng `LiveHub` |
| `LiveHub` | Quản lý hai loại kết nối: viewer (đã có) và gateway (mới). Tập `wanted` suy ra từ viewer còn sống như hiện nay, sau đó đẩy `watch` cho gateway khi tập đổi |
| D1 trong hub | Hub cần binding `DB` cho `bind` và ghi theo sự kiện (Q-D2: đề xuất cho hub binding `DB`, dùng lại hàm trong `db/sql.ts` và logic của `live-service`) |
| Thu hồi | Khi khóa bị khóa hoặc cấp lại (`dev-links`), gọi `hub.revokeLink(linkId)`: hub gửi `reject` cho gateway và ngừng phát |
| Chế độ cũ | `GET /gate` và `POST /ingest` giữ nguyên làm đường "direct" đến khi Gateway ổn định (Q5) |
| Schema | `Shared/src/gw-schema.ts`: zod cho các tin ở mục 3 và 4; hằng số trong `LIVE` (thêm `pingSec`, `gwLeaseSec`, `pushSec`) |

Quy tắc ghi D1 mới (giảm so với Plan 3B mục 7):

| Ghi | Khi nào | Mặc định |
|---|---|---|
| `link_state` | Khi có người xem: tối đa 1 lần mỗi 300 giây, cộng một lần khi người xem cuối rời đi. Không xem: không ghi | 300 giây (Plan 3B: 60) |
| `presence` + sự kiện online/offline | Chỉ khi chuyển trạng thái | |
| `trades` | Mỗi sự kiện giao dịch (upsert, loại trùng theo ticket) | |
| `equity_m5` | Chỉ khi đang live, một dòng mỗi nến M5 (Q4) | |
| `last_seen_at` | Không ghi nữa; "Online" lấy từ kết nối WebSocket của Gateway và `state` | |

## 6. Máy trạng thái EA

```mermaid
stateDiagram-v2
  [*] --> TRACK: OnInit (gửi event "ea_start")
  TRACK --> LIVE: ping trả watch=true
  LIVE --> TRACK: watch=false hoặc 2 lần lỗi liên tiếp / hết lease_ms
  TRACK --> GW_DOWN: 3 lần ping lỗi liên tiếp
  LIVE --> GW_DOWN: 3 lần ping lỗi liên tiếp
  GW_DOWN --> TRACK: ping thành công (gửi bù sự kiện)
```

| Trạng thái | EA làm | EA không làm |
|---|---|---|
| `TRACK` | Ping mỗi 5 giây; `event` khi có tín hiệu; hàng đợi sự kiện trong bộ nhớ | Không lấy mẫu 1 giây, không gửi `samples` |
| `LIVE` | Lấy mẫu mỗi 1 giây; gửi `samples` mỗi `interval_ms` (mặc định 2000); `positions` chỉ khi hash đổi | Không gọi mạng trong `OnTick` |
| `GW_DOWN` | Chỉ ghi nhận cục bộ; ping thưa dần (5, 15, 30 giây); lưu `last_ack_deal_time` | Không gửi `samples` |

- **Mất sự kiện:** khi quay lại từ `GW_DOWN`, hoặc khi khởi động lại, EA đối chiếu lịch sử deal từ `last_ack_deal_time` (cơ chế Plan 1 mục 6) và gửi bù. Server loại trùng theo ticket.
- **Khởi động lại terminal:** `sid` mới; trễ ngẫu nhiên 0 đến 5 giây trước ping đầu để nhiều EA không bắn cùng lúc.
- **Hàng đợi ở Gateway:** nhận `event` thì xếp hàng trong bộ nhớ (tối đa 1.000) và ghi một file hàng đợi nhỏ (dưới 1 MB) để sống sót qua khởi động lại Gateway (Q7). Đây không phải DB và không chứa mẫu.
- **EA mới thay `AZ_Spike`:** giữ file `ea/AZ_Spike.mq5` và mở rộng tại chỗ (Q2). Input mới: `InpGateway`, `InpPingSec`, `InpMarginLevelAlert`; bỏ `InpUrl` và `InpIntervalSec` khi đường "direct" bị xóa.

## 7. Gateway, giao diện cục bộ và bộ cài

**Gateway** (Q1 đã chốt: **Node.js + TypeScript**, dùng chung `@az-sentinel/shared`; đóng gói `.exe` xem mục 15):

- Chạy như **Windows Service** tự khởi động cùng máy. Vì không còn truy cập IPC của terminal nên vấn đề Session 0 (dịch vụ không gắn được terminal ở phiên RDP) **không còn tồn tại**; cần xác nhận ở G0.
- Trạng thái trong bộ nhớ: danh sách terminal đã `bind`, mẫu cuối, tập `watch`. Cấu hình ở `%ProgramData%\AZSentinel\config.json`. Log là file xoay vòng (5 tệp × 1 MB), không DB.
- Giao diện cục bộ `http://127.0.0.1:47800/`: trạng thái kết nối cloud, danh sách terminal (số tài khoản, server, "thấy lần cuối", trạng thái EA), phiên bản, nút "Sao chép chẩn đoán".

**Bộ cài** (đề xuất Inno Setup, một file `AZSentinel-Setup.exe`):

1. Cài `gateway.exe`, đăng ký dịch vụ, mở giao diện cục bộ.
2. **Phát hiện terminal** theo bài học spike: tiến trình `terminal64.exe` đang chạy + `origin.txt` (UTF-16) để ánh xạ hash thư mục dữ liệu; bỏ qua thư mục mồ côi.
3. Chép `AZ_Sentinel.ex5` vào `MQL5\Experts\AZ\` của từng terminal tìm thấy.
4. Thêm `http://127.0.0.1:47800` vào danh sách Allow WebRequest của từng terminal. **Chưa chắc ghi được tự động** (nghi là khóa trong `config\common.ini`, phải kiểm ở G0 và phải ghi khi terminal đã đóng). Nếu không được: giao diện cục bộ hiện danh sách việc cần làm một lần cho mỗi terminal.
5. Mã ghép nối: Gateway hiện mã 8 ký tự; nhập mã trên web để gắn VPS (MVP chưa có, xem Q3).

**Tự cập nhật:** hub gửi `update {min_ver, url, sha256}`; Gateway tải về, kiểm băm, thay file và khởi động lại dịch vụ. Ký số bộ cài là việc của Part 4 (tránh cảnh báo SmartScreen).

Gắn EA vào chart vẫn là **một lần thủ công mỗi terminal** (Algo Trading bật). Vì terminal chạy 24/7 và profile giữ EA qua khởi động lại nên không phải làm lại.

## 8. Thay đổi ở FE

Hầu như không đổi. Việc cần làm:

- Thêm trạng thái `offline` vào `LIVE_STATES` (Gateway hoặc terminal mất kết nối), huy hiệu "Mất kết nối".
- Chỉnh chữ: "Đang đánh thức EA" chỉ còn vài giây, bỏ chữ "tối đa 120 giây".
- Cập nhật `Docs/AZ_Sentinel_Rules_FE.md` mục 5 và 14 như L0 của Plan 3B (WebSocket thay poll trên `/links`).

## 9. Ngân sách (ước tính, phải đo)

Giả định: 8 VPS (A3, A4, A6, A8, A9, A12, bot-A21, Test bot), 30 terminal, `push_sec = 2`. Tin WebSocket đến hub tính 20:1; tin đi và ping giao thức không tính ([nguồn](https://developers.cloudflare.com/durable-objects/platform/pricing)).

| Hạng mục (mỗi ngày) | Plan 3B | Plan 3C |
|---|---|---|
| Nền (không ai xem): request Worker | 21.600 | khoảng 8 (mỗi lần nối lại WebSocket) |
| Nền: request Durable Object | 21.600 | vài chục (tin `state`) |
| Nền: dòng ghi D1 | 10.800 | vài chục (đổi trạng thái, sự kiện lệnh) |
| Live liên tục 24 giờ: request DO quy đổi | 259.200 (30 EA × 10 giây) | 17.280 (14.400 tin/giờ ÷ 20 × 24) |
| 3 giờ live cho cả hệ thống: request DO quy đổi | 32.400 | 2.160 |
| 3 giờ live: dòng ghi D1 (`link_state` + nến M5) | 6.480 | khoảng 2.160 |

Cách tính tin live: 8 VPS × 1.800 tin/giờ (mỗi 2 giây) = 14.400 tin/giờ, chia 20 ra 720 request quy đổi/giờ. Cách tính D1: 30 terminal × (12 lần `link_state` + 12 nến M5) mỗi giờ = 720 dòng/giờ. Điểm chưa biết, phải đo: DO có tốn thời gian chạy khi mỗi 2 giây có tin (không ngủ đông được), tin `batch` lớn nhất bao nhiêu byte với 20 mẫu × nhiều terminal, `INSERT OR IGNORE` trùng khóa có tính dòng ghi hay không.

## 10. Kiểm thử

**Gateway** (với EA giả và cloud giả):

| ID | Case | Kỳ vọng |
|---|---|---|
| G-01 | Không viewer, 3 terminal ping 5 giây | 0 tin `batch`; chỉ ping giao thức |
| G-02 | Hub gửi `watch` cho 1 terminal | Phản hồi `ping` kế tiếp có `watch:true`; chỉ terminal đó gửi `samples` |
| G-03 | `watch` rỗng | Các EA về `TRACK` trong một chu kỳ `ping` |
| G-04 | Cloud mất kết nối | Nối lại backoff; `event` xếp hàng; không mất sự kiện |
| G-05 | Gateway khởi động lại có hàng đợi | Gửi bù, không trùng (theo `seq`) |
| G-06 | Hai terminal cùng `key` khác tài khoản | `reject 409` cho terminal thứ hai |
| G-07 | Phản hồi `ping` chậm hơn 50 ms | Không xảy ra ở 30 terminal ping đồng thời (đo p99). **Đo sơ bộ (21/10/2026, sandbox Linux):** 30 client bắn liên tục, không nghỉ: p50 24 ms, p99 251 ms. Kịch bản đó nặng hơn thực tế nhiều (thực tế 30 terminal × 1 ping/5 giây ≈ 6 request/giây). Phải đo lại với tải thực và trên VPS Windows |
| G-08 | Cổng 47800 bị chiếm | Báo lỗi rõ trên giao diện, thử cổng cấu hình khác |

**BE (đường Gateway):**

| ID | Case | Kỳ vọng |
|---|---|---|
| B-31 | Kết nối Gateway không `bind` trong 10 giây | Bị đóng |
| B-32 | `bind` khóa sai, khóa bị khóa | `reject 401`, `reject 403`; 0 dòng ghi |
| B-33 | Viewer vào, rồi rời | `watch` có terminal, rồi rỗng; 0 request Worker mới |
| B-34 | `batch` hợp lệ khi có viewer | Viewer nhận `samples`; `link_state` ghi tối đa 1 lần mỗi 300 giây |
| B-35 | `batch` khi không còn viewer | Bỏ, không phát, không ghi |
| B-36 | `state` đổi online/offline | Đúng 1 sự kiện mỗi lần đổi; lặp lại trạng thái cũ ghi 0 dòng |
| B-37 | `event` trùng `seq` | `ack`, 0 dòng ghi thêm |
| B-38 | Cấp lại khóa khi đang live | `reject` cho Gateway; ngừng phát |
| B-39 | Hub ngủ đông rồi dậy | Gateway và viewer khôi phục, `watch` được gửi lại |
| B-40 | Snapshot `rows_written` | Khớp bảng mục 5 |

**EA trên MT5 demo (thủ công):**

| ID | Case | Kỳ vọng |
|---|---|---|
| A-01 | Allow WebRequest `http://127.0.0.1:47800`, ping thật | 200; ghi p99 thời gian `WebRequest` |
| A-02 | Gateway tắt giữa lúc live | EA về `GW_DOWN` trong 15 giây; không treo `OnTimer` |
| A-03 | Mở rồi đóng một lệnh | 2 sự kiện đến cloud trong dưới 2 giây; không trùng |
| A-04 | Tắt rồi mở lại terminal | `sid` mới; không mất sự kiện lúc tắt |
| A-05 | 4 terminal cùng VPS (như A8) chạy đồng thời | Cả 4 `bind` thành công, ping ổn định |
| A-06 | 200 lệnh mở | Kích thước payload `samples`/`positions`, thời gian dựng JSON |
| A-07 | Cuối tuần | Ping vẫn chạy, `samples` vẫn gửi khi live |

**E2E (cả hệ thống, tự động bằng EA giả + Gateway giả + viewer giả):**

| ID | Case | Kỳ vọng |
|---|---|---|
| E-21 | Không viewer 10 phút | 0 `batch`, 0 dòng ghi D1 |
| E-22 | Viewer vào | Mẫu đầu đến FE dưới 7 giây |
| E-23 | Viewer rời | Ngừng gửi mẫu trong một chu kỳ `ping` |
| E-24 | 30 terminal, 3 viewer, 10 phút | Số tin và dòng ghi khớp mục 9 (lệch dưới 30%) |
| E-25 | Hub bị khởi động lại | Gateway nối lại, live tiếp |

**Bộ cài:**

| ID | Case | Kỳ vọng |
|---|---|---|
| I-01 | Cài sạch trên VPS có 4 terminal (A8) | Phát hiện đúng 4, bỏ qua thư mục mồ côi |
| I-02 | Gỡ cài | Xóa dịch vụ và file; không xóa dữ liệu terminal |
| I-03 | Cập nhật tự động | Băm sai thì từ chối; đúng thì thay và khởi động lại |
| I-04 | Dung lượng | Tổng cài dưới 30 MB (VPS ít ổ đĩa) |

## 11. Phân rã công việc

Ký hiệu như Plan 3: **[Claude viết, Bạn chạy]**, **[Bạn thao tác]**, **[Cả hai]**.

| Patch | Việc | Phụ thuộc | Xong khi |
|---|---|---|---|
| 05 | Xóa Python | | **XONG** (commit `d71673f`) |
| 06 | Tài liệu này | 05 | **XONG** v0.2. Q1 chốt Node/TS; Q2 đến Q7 giữ như đề xuất |
| G0 | **Spike A8:** EA stub gửi `ping` tới `127.0.0.1`, đo trễ, thử thêm URL vào `common.ini`, thử dịch vụ chạy khi không đăng nhập RDP **[Cả hai]** | 06 | A-01, A-05 đạt; ghi `spike-results.md` mục 6 |
| 07 | `Shared/src/gw-schema.ts` và test | 06 | **XONG** (52 test xanh) |
| 08 | **CHƯA LÀM.** BE: đầu nối Gateway trong `LiveHub`, `bind`, `watch`, ghi theo sự kiện, `revokeLink` **[Claude viết, Bạn chạy]** | 07 | B-31 đến B-40 xanh |
| 09 | Công cụ thử: `Gateway/dev/fake-cloud.ts` (thay hub, chưa cần BE) và `Gateway/dev/fake-ea.ts` | 07 | **XONG**. G-01 đến G-06, G-08, E-21 đến E-23 và E-25 xanh bằng cloud giả (E-24 chưa làm; E-21 mới chạy 1,5 giây, không phải 10 phút). Đổi vị trí so với kế hoạch cũ: nằm trong `Gateway/dev`, không còn `Scripts/fake-gateway.ts` |
| 10 | EA: mở rộng `AZ_Spike.mq5` v0.2.0 (TRACK/LIVE/GW_DOWN, `event`, `samples`) | 09 | **Mã xong, chưa biên dịch và chưa chạy trên MT5**. Còn A-01 đến A-07 **[Bạn chạy]** |
| 11 | Gateway thật + giao diện cục bộ | 09, Q1 | **Mã xong**, G-01 đến G-06 và G-08 xanh với EA giả. Còn G-07 (đo p99 với EA thật) |
| 12 | Bộ cài, phát hiện terminal, tự cập nhật **[Claude viết, Bạn chạy trên A8]** | 10, 11 | I-01 đến I-04 đạt |
| 13 | FE: trạng thái `offline`, chỉnh chữ; sửa Rules FE **[Claude viết, Bạn chạy]** | 08 | Test FE xanh |
| 14 | Đo ngân sách, cửa GO sang Part 4 **[Cả hai]** | 12, 13 | Lệch dưới 30% so với mục 9 |

Cửa GO sang Part 4:

- [ ] Toàn bộ test G, B, A, E, I đạt.
- [ ] E-21 khẳng định 0 request và 0 dòng ghi khi không ai xem.
- [ ] 4 terminal A8 chạy qua một Gateway 24 giờ, số tin khớp dashboard Cloudflare.
- [ ] Một lần cập nhật phiên bản MT5 trên một VPS thử không làm hỏng tracking.
- [ ] Đường "direct" (`/gate`, `/ingest` live) đã gỡ, hoặc có quyết định giữ.

## 12. Quyết định cần chốt

| # | Quyết định | Đề xuất | Hệ quả |
|---|---|---|---|
| Q1 | Ngôn ngữ Gateway | **ĐÃ CHỐT: Node/TS** (bản làm việc hiện tại) | Dùng chung zod với BE nên lệch giao thức bị bắt ở compile. Đổi lại bản đóng gói khoảng 80–100 MB (chưa đo); phải kiểm dung lượng ở I-04. Nếu quá nặng cho VPS ít ổ đĩa, viết lại bằng Go sau, giữ `Gateway/test` làm test hợp đồng |
| Q2 | Tên EA | Giữ `ea/AZ_Spike.mq5`, mở rộng tại chỗ; đổi tên khi phát hành | Giữ được lịch sử git |
| Q3 | Xác thực | MVP: khóa theo liên kết (EA nhập `InpApiKey`). Sau: ghép nối VPS bằng mã, tự tạo liên kết theo tài khoản | MVP không đổi schema D1; ghép nối làm ở Part 2 |
| Q4 | Lịch sử equity M5 | Chỉ ghi khi có người xem | Biểu đồ có "lỗ hổng" lúc không ai xem; rẻ nhất |
| Q5 | `/gate` và `/ingest` live cũ | Giữ đến khi Gateway ổn định, rồi xóa | Giữ test cũ chạy trong lúc chuyển |
| Q6 | `push_sec` mặc định | 2 giây (EA lấy mẫu 1 giây), kẹp 1 đến 5 | Ở 1 giây gấp đôi số tin |
| Q7 | Hàng đợi sự kiện ở Gateway | Bộ nhớ + file nhỏ | Chỉ bộ nhớ thì EA phải gửi bù sau mỗi lần Gateway khởi động lại |

## 13. Rủi ro

- **Allow WebRequest phải làm cho từng terminal.** Nếu không ghi tự động được, đó là bước thủ công mỗi terminal. Nhẹ hơn nhiều so với một API key riêng trong cloud, nhưng vẫn là việc của EndUser. Giảm thiểu: giao diện cục bộ hiện checklist; G0 kiểm cách ghi `common.ini`.
- **`WebRequest` chặn luồng EA.** Gateway trả lời dưới 50 ms; EA dùng timeout 1 giây; đo ở A-01 và G-07.
- **Gateway là điểm lỗi duy nhất mỗi VPS.** Dịch vụ Windows có tự khởi động lại; EA vẫn ghi nhận cục bộ và gửi bù sau.
- **Cổng cục bộ bị tiến trình khác lạm dụng.** Chỉ nghe `127.0.0.1`; mọi request cần `key` hợp lệ; hub kiểm lại bằng `bind`.
- **Một Durable Object toàn cục chịu cả viewer lẫn Gateway.** Đủ cho 8 VPS và 30 terminal; nếu tăng thì tách theo chủ sở hữu.
- **Hibernation.** Khi có viewer, tin mỗi 2 giây giữ hub thức; khi không, im lặng nên ngủ đông. Phải đo thời gian chạy ở E-24.
- **Cảnh báo SmartScreen và Defender với `.exe` chưa ký.** Ký số ở Part 4; trước đó thêm ngoại lệ thủ công.
- **EA phải được gắn vào chart.** Không tự động hóa được hoàn toàn; giao diện cục bộ hiện "terminal chưa thấy EA" bằng cách so danh sách terminal đang chạy (mục 7) với các terminal đã `bind`.
- **Terminal mới cập nhật.** Rủi ro thấp hơn Python (chỉ dùng API MQL5 có tài liệu) nhưng vẫn kiểm bằng cửa GO.

## 14. Tài liệu cần sửa khi bắt đầu làm

| Tài liệu | Sửa |
|---|---|
| `AZ_Sentinel_Plan3B_Live_On_Demand.md` | Mục 2 (phương án gate), 4 (giao thức EA → server), 5 (máy trạng thái EA), 8 (ngân sách), 11 (case E, M) đã bị Plan 3C thay thế; giữ mục 1, 6, 7 (viewer, hub) |
| `AZ_Sentinel_Rules_FE.md` | Mục 5 và 14: WebSocket thay poll trên `/links` (đã nêu ở L0 của Plan 3B) |
| `AZ_Sentinel_Plan2_System_DB.md` | Mục 6, 8, 9: luồng ingest và ngân sách theo Plan 3C |
| `AZ_Sentinel_Local_Setup.md` | Thêm mục Gateway và bộ cài khi có |
| `spike-results.md` mục 6 | Điền P1-27 đến P1-29 bằng số đo ở G0 |

## 15. Chạy cục bộ trên VPS (hướng dẫn vận hành)

### 15.1 Luồng dữ liệu

```
EA (mỗi terminal) --HTTP 127.0.0.1:47800--> Gateway (1 tiến trình/VPS) --1 WebSocket--> Cloud (LiveHub)
```

- **EA → Gateway là polling cục bộ** (HTTP, gần như miễn phí). EA hỏi mỗi 5 giây; khi `watch:true` thì gửi `samples` mỗi `interval_ms`. Không dùng WebSocket trong MQL5 vì MQL5 không có WebSocket gốc, còn `WebRequest` đơn giản và có tài liệu.
- **Gateway → Cloud là WebSocket bền duy nhất.** Gateway giữ kết nối, tự nối lại backoff 1 đến 60 giây, gửi `ping` văn bản mỗi 30 giây, coi là chết nếu im lặng quá 75 giây.
- **Cloud không gọi vào VPS.** Mọi kết nối do Gateway chủ động mở ra, nên VPS không cần mở cổng vào.

### 15.2 Gateway: cấu hình

Thứ tự ưu tiên: biến môi trường ghi đè file `config.json` ghi đè mặc định.

| Cấu hình | Biến môi trường | Mặc định |
|---|---|---|
| `port` | `AZ_GW_PORT` | 47800 |
| `cloudUrl` | `AZ_GW_CLOUD_URL` | rỗng = chỉ chạy cục bộ, không live |
| `cloudToken` | `AZ_GW_TOKEN` | rỗng; bản deploy bắt buộc đặt cùng giá trị `GW_CONNECT_TOKEN` của Worker (Plan 3D) |
| `idleFlushSec` | `AZ_GW_IDLE_FLUSH_SEC` | 1800; không ai xem thì `state`/`event` chờ chừng này giây mới đẩy gộp, 0 = gửi ngay (Plan 3D) |
| `vps` | `AZ_GW_VPS` | tên máy |
| `dataDir` | `AZ_GW_DATA` | `%ProgramData%\AZSentinel` (Windows), `~/.az-sentinel` (khác) |
| `logLevel` | `AZ_GW_LOG` | `info` |
| (đường dẫn file cấu hình) | `AZ_GW_CONFIG` | `<dataDir>/config.json` |

Ví dụ `C:\ProgramData\AZSentinel\config.json`:

```json
{ "port": 47800, "cloudUrl": "wss://<ten>.workers.dev/api/gw/ws", "vps": "VPS-A8" }
```

### 15.3 Chạy thử trên máy dev (chưa cần BE)

Ba cửa sổ terminal, từ gốc repo:

```bash
pnpm install
# 1) Cloud giả (thay LiveHub): w = bật/tắt "có người xem", r = từ chối 409, s = trạng thái
pnpm --filter @az-sentinel/gateway fake-cloud
# 2) Gateway thật
AZ_GW_CLOUD_URL=ws://127.0.0.1:8788/api/gw/ws pnpm --filter @az-sentinel/gateway start
# 3) EA giả (không cần MT5): t = bắn sự kiện đóng lệnh
pnpm --filter @az-sentinel/gateway fake-ea -- --key <API_KEY_BAT_KY_20_KY_TU> --login 4242
```

Windows PowerShell: đặt biến bằng `$env:AZ_GW_CLOUD_URL="ws://127.0.0.1:8788/api/gw/ws"` rồi chạy lệnh 2.

Kỳ vọng: cloud giả in `hello`, `bind`, `state`; **không có `batch`** cho tới khi bấm `w`; sau `w` EA giả nhận `watch=true` trong tối đa 5 giây và `batch` đến đều; bấm `w` lần nữa thì `batch` dừng. Mở `http://127.0.0.1:47800/` xem trang trạng thái.

### 15.4 Gắn EA thật vào từng terminal (làm một lần mỗi terminal)

1. Biên dịch `ea/AZ_Spike.mq5` (MetaEditor, F7) hoặc dùng `ea/compile.ps1`. Chép `.ex5` vào `MQL5\Experts\` của terminal.
2. Terminal: **Tools > Options > Expert Advisors > Allow WebRequest for listed URL** và thêm `http://127.0.0.1:47800`. Không thêm thì `WebRequest` báo lỗi 4014 và EA ghi log hướng dẫn.
3. Gắn EA lên **một** chart bất kỳ (chỉ một EA AZ mỗi terminal; bản thứ hai tự từ chối), bật **Algo Trading**.
4. Nhập `InpApiKey` (khóa của liên kết). Giữ `InpGateway` mặc định, `InpPingSec` 5, `InpMarginLevelAlert` 0 (tắt) hoặc ví dụ 150.
5. Tab **Experts** phải có `AZ: bat dau, ver 0.2.0` rồi sau vài giây `AZ: da gan voi lien ket tren cloud.` (khi cloud đã chạy). Trang `http://127.0.0.1:47800/` hiện terminal ở trạng thái Online.

Nhiều terminal cùng VPS dùng chung một Gateway, mỗi terminal một EA và một khóa.

### 15.5 Chạy Gateway như dịch vụ (đề xuất, chưa làm)

- Chạy tạm: Task Scheduler, trigger "At startup", chạy `node` (hoặc `tsx src/main.ts`) bằng tài khoản có quyền ghi `%ProgramData%\AZSentinel`, bật "Restart on failure".
- Chính thức: gói bằng bộ cài ở patch 12 (Windows Service). Hai lựa chọn đóng gói cần thử ở G0: Node SEA (một `.exe`) hoặc kèm `node.exe` cạnh bundle `esbuild`. Mục tiêu tổng dung lượng dưới 30 MB (I-04) có thể không đạt với Node; ghi số đo thật vào `spike-results.md`.

### 15.6 Hành vi khi hỏng (đã kiểm bằng test)

| Sự cố | Hành vi |
|---|---|
| Cloud mất kết nối | Gateway xóa `watch` ngay, EA về TRACK ở ping kế tiếp; sự kiện giữ trong hàng đợi (tối đa 1.000, ghi `queue.json` dưới 1 MB) và gửi bù khi `bound` lại |
| Gateway chết | EA: 2 lỗi liên tiếp rời LIVE, 3 lỗi vào GW_DOWN, ping thưa 5/15/30 giây; sự kiện giữ trong hàng đợi EA (tối đa 100), sau cùng đối chiếu lịch sử deal từ mốc ack (`GlobalVariable AZS_ack_<login>`) |
| Gateway khởi động lại | Nạp lại `queue.json`; EA gửi lại cùng `seq`, Gateway loại trùng |
| Khóa bị từ chối (401/403/409) | Ping báo `bind:"rejected"` + mã; sự kiện của terminal đó bị bỏ, không live |
| Port 47800 bị chiếm | Gateway thoát với thông báo rõ; đổi `port` rồi đổi `InpGateway` và Allow WebRequest tương ứng |
| Request lạ vào cổng cục bộ | Chỉ nghe `127.0.0.1`; `Host` khác loopback bị 403 (chống DNS rebinding); body quá 128 KB bị 413 |

### 15.7 Giới hạn hiện tại (nói thẳng)

- **Chưa có BE phía `/api/gw/ws`.** Gateway thật chỉ nói chuyện được với `fake-cloud` cho tới khi làm patch 08. Vì vậy chưa có live thật trên web.
- **EA chưa được biên dịch và chưa chạy trên MT5.** Đã rà tĩnh (cân bằng ngoặc, hàm gọi/định nghĩa) và có test hợp đồng JSON (`ea-payloads.test.ts`, JSON chép tay theo định dạng EA sinh), nhưng đó không thay được A-01 đến A-07. Lỗi biên dịch MQL5 nhỏ là khả năng cao ở lần biên dịch đầu.
- **Số đo trễ p99 chỉ là sơ bộ** (mục 10, G-07).
- **Xác thực cục bộ chỉ dựa `key` trong body**; tiến trình khác trên cùng VPS có thể đọc/ghi qua loopback nếu biết khóa. Chấp nhận ở MVP (Q3).
