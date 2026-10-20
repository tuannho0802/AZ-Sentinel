# AZ Sentinel — Plan 1: Thiết kế EA gửi request

> Bản nháp v0.3 · 20/10/2026 · Dành cho MT5 (MQL5).
> Hệ thống web, DB và codebase nằm ở file `AZ_Sentinel_Plan2_System_DB.md`.
> Thay đổi so với v0.2: xem mục 12.

## 0. Mục tiêu, thuật ngữ và giả định

- **Mục tiêu:** mỗi tài khoản MT5 chạy một EA “reporter” gửi dữ liệu tài khoản và lệnh về server, để web theo dõi khoảng 30 tài khoản: online/offline, balance, equity, floating P/L, lệnh đang mở, lịch sử lệnh, và biết VPS nào đang treo EA nào.
- **User:** tài khoản đăng nhập web. **TKGD:** tài khoản giao dịch MT5 mà EA đang chạy. **Liên kết EA:** một TKGD gắn với một API key.
- **Nguyên tắc xuyên suốt:** EA chỉ đọc và báo cáo; gửi theo sự kiện thay vì gửi liên tục; mọi request idempotent; ít request nhất có thể nhưng không bao giờ mất sự kiện giao dịch.
- **Giả định cần xác nhận:** EA chạy MT5; mỗi EA theo dõi symbol của chart (có thể thêm danh sách symbol cho trigger biến động).

## 1. Vai trò và nguyên tắc

- EA **chỉ đọc**: không gọi lệnh giao dịch và không thực thi lệnh giao dịch nhận từ server. Server chỉ được gửi lệnh điều khiển báo cáo (đổi chu kỳ, ping).
- Tách thành thư viện `AZ_Reporter.mqh` và EA vỏ `AZ_Sentinel_Reporter.mq5`. Sau này nhúng thư viện vào EA giao dịch của bạn mà không phải viết lại.
- Mỗi TKGD chỉ chạy **một** reporter. Khóa chống chạy trùng bằng biến toàn cục của terminal, **có thời hạn**: reporter ghi dấu thời gian vào biến khóa mỗi nhịp; reporter mới chỉ chiếm khóa khi dấu cũ quá 30 giây. Cách này tránh khóa “mồ côi” sau khi terminal hoặc EA bị tắt đột ngột (biến toàn cục của terminal còn lại sau khi tắt).
- Mọi việc chạy trong `OnTimer` (nhịp 1 giây). `OnTick` không gọi mạng. Việc kiểm tra điều kiện là tính toán cục bộ, chỉ gọi `WebRequest` khi có trigger.
- Trong Strategy Tester không gửi (WebRequest không dùng được ở đó), chỉ ghi log.
- `WebRequest` chạy đồng bộ và chặn luồng EA. Vì vậy timeout ngắn (3 giây), và sự kiện giao dịch bị lỡ do chặn sẽ được bù bằng cơ chế đối chiếu lịch sử deal (mục 6).

## 2. Inputs

| Input | Mặc định | Ý nghĩa |
|---|---|---|
| `InpServerUrl` | — | Địa chỉ HTTPS của API (phải thêm vào danh sách URL cho phép của terminal) |
| `InpApiKey` | — | Khóa của liên kết EA, mỗi EA một khóa riêng |
| `InpVpsLabel` | — | Nhãn VPS, ví dụ `VPS-A12`, `VPS-B51`. **Không ảnh hưởng logic EA**, chỉ gửi kèm mỗi request |
| `InpHeartbeatSec` | 300 | Gửi dự phòng nếu quá chừng này giây chưa gửi gì |
| `InpSymbols` | trống | Symbol theo dõi biến động (trống = symbol của chart) |
| `InpVolMode` | 2 | 0 tắt, 1 một nến, 2 biên độ cửa sổ, 3 tổng biên độ |
| `InpVolBars` | 5 | Số nến M1 đã đóng để xét |
| `InpVolThreshold` | — | Ngưỡng theo khoảng giá (ví dụ 10.0) |
| `InpVolAtrMult` | 0 | Nếu > 0: ngưỡng = bội số ATR(14) của M1, thay cho ngưỡng cố định |
| `InpVolCooldownSec` | 30 | Khoảng nghỉ tối thiểu giữa hai lần gửi do biến động |
| `InpVolMaxPerHour` | 20 | Trần số lần gửi do biến động mỗi giờ |
| `InpMarginLevelWarn` | — | Ngưỡng margin level (%) để báo rủi ro |
| `InpDrawdownWarnPct` | — | Ngưỡng drawdown (%) để báo rủi ro |
| `InpHttpTimeoutMs` | 3000 | Timeout của WebRequest |
| `InpMaxPositions` | 200 | Số lệnh tối đa trong một payload |
| `InpIncludePending` | true | Có gửi lệnh chờ không |
| `InpDebug` | false | Log chi tiết (không bao giờ ghi API key) |

Nhãn VPS được EA tự làm sạch: cắt khoảng trắng, tối đa 32 ký tự, chỉ cho chữ, số, gạch ngang, gạch dưới và dấu chấm. Server chuẩn hóa thêm (viết hoa).

## 3. Các trigger gửi

Thứ tự ưu tiên từ cao xuống thấp:

1. **trade_event:** có giao dịch (mở, đóng, sửa SL/TP, đảo chiều) qua `OnTradeTransaction`. Sự kiện vào hàng đợi; `OnTimer` gom các sự kiện trong 1-2 giây thành một request.
2. **risk:** margin level xuống dưới ngưỡng hoặc drawdown vượt ngưỡng. Gửi một lần khi vượt ngưỡng, có độ trễ (hysteresis) để không báo lặp.
3. **m5_bar:** phát hiện nến M5 mới của chart (so sánh `iTime` với lần trước, ở nhịp 1 giây). Thêm độ trễ ngẫu nhiên 0-20 giây theo số tài khoản để 30 EA không bắn cùng một giây.
4. **volatility:** xem mục 4.
5. **heartbeat:** nếu quá `InpHeartbeatSec` chưa gửi gì, kể cả cuối tuần hoặc lúc thị trường đóng cửa. Nhờ vậy server phân biệt được “thị trường yên” và “EA chết”.

**Quy tắc gộp:** nhiều trigger trong cùng một nhịp thì gửi **một** request, trường `reason` liệt kê tất cả. Khoảng cách tối thiểu giữa hai request là 5 giây (riêng trade_event có thể gửi sớm hơn nhưng không dưới 2 giây).

## 4. Điều kiện biến động

Đánh giá khi một nến M1 vừa **đóng** (shift 1 đến shift N), không đánh giá theo nến đang chạy để kết quả ổn định.

- **Mode 1, một nến:** có ít nhất một nến với `high - low` ≥ X.
- **Mode 2, biên độ cửa sổ (đề xuất):** `highest high - lowest low` của N nến ≥ X. Bắt được cả cú giật một nến lẫn xu hướng nhiều nến, và không cộng dồn nhiễu.
- **Mode 3, tổng biên độ:** tổng `high - low` của N nến ≥ X (theo ý tưởng ban đầu). Dễ gửi dư khi thị trường đi ngang có nhiễu vì đo quãng đường đi chứ không phải mức dịch chuyển ròng; giữ lại để so sánh.
- **Ngưỡng:** dùng khoảng giá hoặc bội số ATR, không dùng “pip”, vì sàn 2 và 3 chữ số cho cùng một khoảng giá nhưng số point khác nhau (ví dụ vàng 4010.00 → 4000.00 và 4010.000 → 4000.000 đều là 10,0 đơn vị giá). Quy đổi bằng `SYMBOL_POINT` và `SYMBOL_DIGITS`.
- **Chống bắn lặp:** chỉ gửi khi điều kiện chuyển từ sai sang đúng (trạng thái “armed”), có cooldown và trần số lần mỗi giờ. Payload ghi thêm hướng (lên/xuống), biên độ và cửa sổ đã xét.
- **Đảm bảo trần tải:** `InpVolMaxPerHour` (mặc định 20) là trần cứng; cooldown 30 giây chỉ giữ khoảng cách giữa hai lần gửi. Mỗi EA do biến động không bao giờ gửi quá 20 request/giờ.
- **Nhiều symbol:** với mỗi symbol trong `InpSymbols`, EA cần `SymbolSelect` và đảm bảo dữ liệu M1 đã được tải; nếu chưa có dữ liệu thì bỏ qua symbol đó ở nhịp này và ghi log.

## 5. Nội dung gửi (payload)

Thời gian là Unix giây (UTC), kèm giờ máy chủ broker để đối chiếu. Endpoint: `POST /api/ea/v1/ingest`, header `X-API-Key`. Ví dụ rút gọn:

```json
{"v":1,"sid":"a91f3c","seq":10482,"reason":["m5_bar"],"ts_utc":1792500000,"vps":"VPS-A12","ea_ver":"0.1.0","account":{"login":12345678,"name":"Nguyen Van A","broker":"Broker Ltd","server":"Broker-Live01","balance":10250.40,"equity":10311.15,"floating_pl":60.75,"margin_level":2455.0},"positions":[{"ticket":998877,"symbol":"XAUUSD","type":"buy","volume":0.10,"time":1792499000,"price":4010.12,"sl":4000.0,"tp":4030.0,"profit":22.4,"comment":"az-bot","magic":20260101}],"events":[]}
```

Các nhóm trường:

- **Tài khoản:** số tài khoản, tên, broker (company), server, tiền tệ, đòn bẩy, loại (real/demo), loại hạch toán (hedging/netting), balance, equity, margin, margin free, margin level, floating P/L.
- **Lệnh đang mở:** ticket (position ticket), symbol, loại lệnh (buy, sell, các loại lệnh chờ), volume, thời gian mở, giá, SL, TP (nếu có), profit, swap, comment, magic. **Ticket và volume là hai trường bổ sung** ngoài danh sách ban đầu, cần để định danh lệnh và biết quy mô lệnh. Trên tài khoản netting, mỗi symbol chỉ có một vị thế; dùng position id làm khóa định danh thay vì giả định mỗi lệnh một ticket.
- **Sự kiện giao dịch:** mỗi sự kiện có deal ticket và position id để server tự loại trùng khi gửi lại.
- **Meta:**
  - `v`: phiên bản schema.
  - `sid`: mã phiên ngẫu nhiên, tạo mới mỗi lần EA khởi động.
  - `seq`: số thứ tự tăng dần trong phiên (lưu bền khi có thể).
  - `reason`, `vps`, `ea_ver`, build terminal.
- **Thời gian:** `ts_utc` lấy từ đồng hồ máy VPS nên có thể lệch. Server **không** dùng nó để tính online/offline; server dùng giờ nhận request. `ts_utc` chỉ để chẩn đoán lệch giờ.
- **Kích thước:** giới hạn theo `InpMaxPositions`; nếu vượt thì gửi cờ `truncated` kèm tổng số lệnh.

## 6. Gửi, thử lại và hàng đợi

- Ghép JSON bằng chuỗi (MQL5 không có JSON gốc). **Bắt buộc có hàm escape** dấu nháy, dấu gạch chéo ngược và ký tự điều khiển, vì comment của broker hoặc EA có thể chứa ký tự lạ. Chuyển sang UTF-8 và bỏ byte kết thúc chuỗi trước khi gửi.
- Header: `Content-Type: application/json` và `X-API-Key`.
- Timeout 3 giây. Lỗi thì thử lại với khoảng chờ tăng dần (5 giây, 15 giây, 60 giây, tối đa 5 phút).
- Hàng đợi cục bộ có trần (ví dụ 200 mục). Khi đầy thì bỏ snapshot cũ trước, **không bỏ sự kiện giao dịch**.
- Sự kiện giao dịch được lưu ra file để sống sót qua việc khởi động lại EA hoặc terminal. Khi khởi động, EA đối chiếu lịch sử deal từ lần ack cuối và gửi bù.
- Server coi một request là mới nếu `sid` khác phiên trước, hoặc `seq` lớn hơn `seq` đã ghi. Nhờ `sid`, việc mất file lưu `seq` (cài lại terminal) không làm server từ chối dữ liệu mới.
- Mã trả về:
  - 200: thành công.
  - 401: khóa sai. Ngừng gửi dày, thử lại mỗi 5 phút, hiện cảnh báo.
  - 403: liên kết bị khóa hoặc User chưa được duyệt.
  - 409: khóa đã gắn với tài khoản khác.
  - 429: chờ theo `Retry-After`.
  - 5xx: thử lại.
- Nếu lỗi do URL chưa được cho phép trong terminal (thường là mã 4014 trên MT5, cần đối chiếu tài liệu MQL5), hiện hướng dẫn thêm URL vào Tools → Options → Expert Advisors.
- Phản hồi của server rất nhỏ: `ack_seq`, `next_interval_sec` (tùy chọn) và danh sách lệnh điều khiển. Phiên bản đầu chỉ hỗ trợ `set_interval` và `ping`. EA chỉ xóa sự kiện khỏi hàng đợi sau khi nhận `ack_seq`.

## 7. Bảo mật phía EA

- Chỉ dùng HTTPS.
- API key nằm trong thiết lập chart (dạng văn bản thường trên máy VPS), nên mỗi EA dùng khóa riêng và có thể thu hồi từ web. Không ghi key vào log.
- EA không chứa mật khẩu giao dịch hay investor password của bất kỳ tài khoản nào.
- EA không nhận lệnh giao dịch từ server dưới bất kỳ hình thức nào.

## 8. Hiển thị trên chart

Dùng `Comment()` hiển thị: trạng thái (OK hoặc lỗi), thời điểm gửi gần nhất, nhãn VPS, số mục trong hàng đợi, lần heartbeat tiếp theo. Không vẽ đối tượng nặng.

## 9. Kiểm thử

- Escape JSON với comment có dấu nháy, tiếng Việt, ký tự điều khiển.
- Mất mạng, server chậm, các mã 401, 403, 409, 429, 5xx.
- Cuối tuần hoặc đóng cửa thị trường (vẫn có heartbeat).
- Khởi động lại terminal giữa chừng (không mất, không trùng sự kiện).
- Tắt đột ngột terminal rồi mở lại (khóa chống trùng không bị kẹt).
- 200 lệnh mở cùng lúc; đo thời gian xử lý của `OnTimer`.
- Hai reporter cùng một TKGD (khóa chống trùng hoạt động).
- Tài khoản hedging và netting.
- Chạy demo 48 giờ, so số request thực tế với dự báo (khoảng 350-450 request mỗi EA mỗi ngày).

## 10. Mốc triển khai EA

1. **v0.1:** heartbeat + m5_bar + payload tài khoản và lệnh mở.
2. **v0.2:** trade_event + hàng đợi + retry + file lưu bền.
3. **v0.3:** biến động + rủi ro + nhãn VPS đầy đủ + `Comment()`.
4. **v1.0:** kiểm thử demo dài hạn, đóng gói `.ex5`, tài liệu cài đặt.

## 11. Câu hỏi mở cho EA

1. EA chạy MT5, MT4 hay cả hai? (Kế hoạch này viết cho MT5.)
2. Mỗi EA theo dõi một symbol hay nhiều symbol cho trigger biến động?
3. Có cần gửi lệnh chờ (pending order) không?
4. Có cần EA nhận lệnh điều khiển nào ngoài `set_interval` và `ping` không?

## 12. Thay đổi so với v0.2

- Khóa chống chạy trùng có thời hạn, tránh khóa mồ côi sau khi tắt đột ngột.
- Thêm `sid` (mã phiên) để server chấp nhận dữ liệu khi `seq` bị đặt lại.
- Nói rõ server không dùng `ts_utc` của EA để tính online/offline.
- Thêm xử lý tài khoản hedging/netting và nhiều symbol.
- Sửa mô tả trần tải biến động: trần cứng là `InpVolMaxPerHour`.
- Ghi rõ `WebRequest` chặn luồng và cách bù sự kiện bị lỡ.
