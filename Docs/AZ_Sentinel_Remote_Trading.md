# Giao dịch thủ công từ xa (v0.2.6, Pha 1)

Đảo ngược có chủ đích nguyên tắc "EA chỉ đọc" của Plan 1: quản trị viên đóng lệnh, đóng một phần và sửa SL/TP
từ trang chi tiết liên kết. **Pha 2 (đặt lệnh mới) chưa làm.**

## Đường đi của một lệnh
FE `POST /api/links/:id/trade` -> hub (`sendTrade`) -> Gateway (WS `trade`) -> EA (trường `tr_*` trong phản hồi
`/v1/ping` hoặc `/v1/samples`) -> EA thực thi -> `POST /v1/trade_result` -> Gateway -> hub -> người xem (`trade_result`).
202 từ server chỉ nghĩa là lệnh đã được chuyển đi; kết quả thật (retcode MT5) đến sau qua WebSocket.
Trang chi tiết đang ở chế độ live theo tick nên EA nhận lệnh trong vài trăm ms; lệnh không xếp hàng chờ.

## Các lớp an toàn (cả bốn đều phải đồng ý)
1. **EA:** `InpAllowRemoteTrading` mặc định `false`. Chủ terminal phải bật tay; server bị chiếm cũng không giao dịch được.
2. **Liên kết:** cờ `ea_links.trade_enabled` mặc định 0, chỉ admin bật (`POST /api/links/:id/trade-enabled`); gỡ gắn tài khoản thì tắt lại. Cờ này không đồng bộ sang Cloudflare nên bản dự phòng luôn coi là tắt.
3. **Quyền:** chỉ `root_admin` và `admin`. Route ghi dưới `/api/links` vốn đã bị chặn khi chạy dự phòng Cloudflare.
4. **Lệnh:** `cmd_id` duy nhất; hạn dùng 15 giây (EA chỉ bắt đầu khi còn >= 3 giây); EA ghi nhớ `cmd_id` (GlobalVariable) TRƯỚC khi gọi sàn nên tối đa một lần dù bị gửi trùng hay khởi động lại; mỗi liên kết chỉ một lệnh đang chờ; từ chối khi EA đã biết là cũ hơn 0.5.0.

Mọi lệnh ghi vào bảng `trade_log` (ai gửi, lệnh gì, kết quả). Khối lượng đóng một phần không được tự làm tròn: sai bước lot thì từ chối.

## `timeout` nghĩa là KHÔNG BIẾT
Quá hạn mà EA im thì kết quả là `timeout`: lệnh có thể đã chạy. FE nhắc xem lại bảng lệnh trước khi gửi lại. Kết quả muộn của EA vẫn được chuyển tiếp và ghi đè `timeout` (không ghi đè `done`).

## Phát hành: Server 0.2.7, Gateway 0.3.5, EA 0.5.0
Tính năng ra đời trong đợt v0.2.6; bản phát hành đầu tiên mang nó là **Server 0.2.7** và **Gateway 0.3.5** (0.2.6/0.3.4 chưa từng có tag). EA `0.5.0` tự biên dịch, không qua CI.

| Thành phần | Có thay đổi | Cách ra bản | Vì sao |
|---|---|---|---|
| Web (FE) trên VPS | Có (nút giao dịch, footer, hạn chờ FE) | `[release-server]` | Tunnel phục vụ giao diện từ VPS (`Server/src/static.ts`), nằm trong bộ cài Server |
| Server (BE + hub) | Có (route `/trade`, `sendTrade`, migration 0010) | `[release-server]` | Migration tự áp khi Server khởi động |
| Gateway | Có (nhận `trade`, trường `tr_*`, `/v1/trade_result`) | `[release]` | Gateway cũ không hiểu lệnh; bộ cài Server chỉ kèm Gateway cho máy Admin |
| Cloudflare Worker + D1 | Có (cùng mã BE, migration 0010) | `[deploy]` | Giữ Worker cùng lược đồ với VPS; `deploy.yml` tự chạy `db:migrate:remote` trước khi deploy |
| EA | Có (`0.5.0`) | Không có tag | Compile bằng `ea/compile.ps1`, chép vào từng terminal |

Commit đủ bộ: ba tag cùng một message. Chỉ nhắc tới tag trong message mà không muốn chạy workflow thì đừng viết nguyên văn (xem `AZ_Sentinel_CI_Tags_And_Gateway_Power.md`).

Thứ tự áp dụng sau khi release: (1) cài Server mới trên VPS chính (tự áp migration 0010); (2) cài Gateway 0.3.5 trên MỌI VPS có terminal cần giao dịch; (3) compile EA 0.5.0, chép vào terminal; (4) bật `InpAllowRemoteTrading`; (5) admin bật "Giao dịch từ xa" ở thẻ Tài khoản.

## Giới hạn đã biết
- **EA chưa từng được biên dịch hay chạy** ở môi trường phát triển. Test chỉ đọc mã nguồn EA để giữ các bất biến an toàn (xem dưới); chạy thử trên **demo** là bắt buộc.
- Route kiểm phiên bản EA (`>= 0.5.0`) nhưng **chưa kiểm phiên bản Gateway**. Gateway cũ bỏ qua lệnh `trade`; FE không chờ mãi mà báo "không biết" sau `TRADE_CLIENT_WAIT_MS` (28 giây). Việc cần làm sau: hub nhớ `gw_ver` của `hello` và từ chối sớm.
- Chỉ dùng được khi chạy trên Server (VPS). Khi chạy dự phòng Cloudflare, route ghi bị chặn nên không giao dịch.
- Pha 2 (đặt lệnh mới) chưa làm; mã EA cố ý không có đường mở lệnh (test chặn).

## Test tự động của tính năng
| Tệp | Nội dung |
|---|---|
| `Shared/test/trade-schema.test.ts` | Thân lệnh, kết quả EA, `CMD_ID`, hằng số an toàn, `eaVersionAtLeast` |
| `Gateway/test/trade.test.ts` | Giữ một lệnh mỗi terminal, hạn dùng, ân hạn `timeout`, từ chối ngay, mất cloud |
| `Gateway/test/ea-trade-contract.test.ts` | Đọc `ea/AZ_Spike.mq5`: công tắc mặc định tắt, ghi nhớ `cmd_id` TRƯỚC khi gọi sàn, kiểm hạn dùng, không có đường mở lệnh, `reason` nằm trong schema; payload chép tay |
| `BE/test/integration/links-trade.test.ts` | Quyền, công tắc, thân lệnh, phiên bản EA, gửi lệnh, lệnh bận |
| `BE/test/integration/live-hub-trade.test.ts` | Hub chuyển lệnh, phát kết quả, nhật ký, `timeout` bị `done` ghi đè ngược lại |
| `BE/test/integration/trade-sync-isolation.test.ts` | `trade_enabled` không đồng bộ/ghi đè giữa VPS và Cloudflare; ràng buộc `trade_log` |
| `FE/src/features/links/trade-controls.test.tsx` | Nút, hộp xác nhận, kết quả thật, lỗi |
| `FE/src/features/links/trade-outcome.test.tsx` | Hạn chờ phía FE; kết quả muộn vẫn thắng |
| `FE/src/features/links/live/trade-store.test.ts` | Lưu kết quả theo `cmd_id`, trần 20, `margin` theo mẫu `mg` |

## Kiểm thử thủ công trên DEMO (bắt buộc trước khi dùng tài khoản thật)
Chỉ làm trên tài khoản demo. Mỗi bước ghi lại retcode hiển thị trên giao diện.

| Mã | Việc | Kỳ vọng |
|---|---|---|
| T-01 | Compile `ea/AZ_Spike.mq5` bằng `ea/compile.ps1` | 0 lỗi (nếu có, gửi lại log để sửa) |
| T-02 | Admin bật "Giao dịch từ xa", để `InpAllowRemoteTrading = false`, bấm Đóng một lệnh | Thất bại `remote_disabled`; lệnh VẪN mở |
| T-03 | Bật `InpAllowRemoteTrading`, Đóng một lệnh demo | Thành công, mã sàn 10009, lệnh biến mất khỏi bảng |
| T-04 | Đóng một phần đúng bước lot; rồi sai bước lot; rồi phần còn lại < lot tối thiểu | Lần 1 thành công và hiện khối lượng còn lại; hai lần sau `bad_volume`, không lệnh nào bị đổi |
| T-05 | Sửa SL/TP hợp lệ; để trống một ô; SL quá gần giá | Thành công; ô trống = bỏ; SL quá gần `bad_stops` (mã 10016) |
| T-06 | Tắt Algo Trading rồi đóng lệnh | `algo_off`, không lệnh nào chạy |
| T-07 | Đóng ticket vừa được đóng ở nơi khác | `no_position` |
| T-08 | Bấm đóng hai lần liên tiếp rồi khởi động lại EA | Chỉ một lệnh được chạy; lần hai bị báo bận; sau khởi động lại không chạy lại |
| T-09 | Gửi lệnh rồi tắt Gateway | Hết hạn chờ thì báo "không biết"; xem lại bảng lệnh |
| T-10 | Đăng nhập người dùng thường | Không thấy nút giao dịch; gọi thẳng API trả 403 |
| T-11 | Gỡ gắn tài khoản rồi gắn lại | "Giao dịch từ xa" đã về tắt |
