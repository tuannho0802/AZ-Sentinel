# Giao dịch thủ công từ xa (Pha 1 v0.2.6, Pha 2 v0.2.8)

Đảo ngược có chủ đích nguyên tắc "EA chỉ đọc" của Plan 1: quản trị viên thao tác lệnh từ trang chi tiết liên kết.

- **Pha 1 (EA 0.5.0):** đóng lệnh, đóng một phần, sửa SL/TP.
- **Pha 2 (EA 0.6.0):** đóng hàng loạt (`close_all`: tất cả, chỉ lãi, chỉ lỗ, chỉ Buy, chỉ Sell), đặt lệnh Market (`market`), đặt lệnh chờ Limit/Stop (`pending`), cả hai kèm SL/TP. Lệnh MỞ cần thêm công tắc riêng của EA (xem lớp an toàn số 5).

## Đường đi của một lệnh
FE `POST /api/links/:id/trade` -> hub (`sendTrade`) -> Gateway (WS `trade`) -> EA (trường `tr_*` trong phản hồi
`/v1/ping` hoặc `/v1/samples`) -> EA thực thi -> `POST /v1/trade_result` -> Gateway -> hub -> người xem (`trade_result`).
202 từ server chỉ nghĩa là lệnh đã được chuyển đi; kết quả thật (retcode MT5) đến sau qua WebSocket.
Trang chi tiết đang ở chế độ live theo tick nên EA nhận lệnh trong vài trăm ms; lệnh không xếp hàng chờ.

## Các lớp an toàn (bốn lớp cho mọi lệnh, lớp thứ năm thêm cho lệnh mở)
1. **EA:** `InpAllowRemoteTrading` mặc định `false`. Chủ terminal phải bật tay; server bị chiếm cũng không giao dịch được.
2. **Liên kết:** cờ `ea_links.trade_enabled` mặc định 0, chỉ admin bật (`POST /api/links/:id/trade-enabled`); gỡ gắn tài khoản thì tắt lại. Cờ này không đồng bộ sang Cloudflare nên bản dự phòng luôn coi là tắt.
3. **Quyền:** chỉ `root_admin` và `admin`. Route ghi dưới `/api/links` vốn đã bị chặn khi chạy dự phòng Cloudflare.
4. **Lệnh:** `cmd_id` duy nhất; hạn dùng 15 giây (EA chỉ bắt đầu khi còn >= 3 giây); EA ghi nhớ `cmd_id` (GlobalVariable) TRƯỚC khi gọi sàn nên tối đa một lần dù bị gửi trùng hay khởi động lại; mỗi liên kết chỉ một lệnh đang chờ; từ chối khi EA đã biết là cũ hơn 0.5.0.

5. **Lệnh MỞ MỚI (Pha 2, market và pending):** EA có thêm `InpAllowRemoteOpen` (mặc định `false`, tách riêng khỏi `InpAllowRemoteTrading`) và `InpMaxRemoteVolume` (mặc định 1.0 lot) chặn gõ nhầm số lot. EA kiểm công tắc, mã giao dịch (`SymbolSelect`) và khối lượng TRƯỚC khi gọi sàn (hàm `OpenAllowed`). Đóng hàng loạt chỉ cần `InpAllowRemoteTrading`, vì chỉ giảm rủi ro và không mở thêm lệnh.

Mọi lệnh ghi vào bảng `trade_log` (ai gửi, lệnh gì, kết quả). Khối lượng đóng một phần không được tự làm tròn: sai bước lot thì từ chối.

## Lệnh Pha 2 chi tiết
| `op` | Trường | Ghi chú |
|---|---|---|
| `market` | `symbol`, `side` (`buy`/`sell`), `volume`, `sl`, `tp` | `sl`/`tp` = 0 là không đặt |
| `pending` | `symbol`, `kind` (`buy_limit`/`sell_limit`/`buy_stop`/`sell_stop`), `volume`, `price`, `sl`, `tp` | SL/TP phải đúng phía giá vào (mua: SL < giá < TP; bán: TP < giá < SL); FE và server đều chặn (`pendingStopsOk`) |
| `close_all` | `filter` (`all`/`profit`/`loss`/`buy`/`sell`) | Lãi/lỗ tính cả swap (`profit + swap`); đúng 0 không thuộc lãi cũng không thuộc lỗ; lệnh chờ KHÔNG bị hủy |

- **Mã giao dịch:** chỉ ký tự `A-Z a-z 0-9 . _ # @ + -`, tối đa 32 (`SYMBOL_RE`), vì EA tách JSON bằng tìm chuỗi.
- **Phiên bản EA tối thiểu:** lệnh cũ 0.5.0, lệnh Pha 2 là 0.6.0 (`minEaVerForOp`). EA đã biết là cũ thì bị từ chối 409 ngay, không ghi nhật ký.
- **Kết quả:** `order` = ticket lệnh vừa tạo (market, pending); `n_ok`/`n_fail` = số lệnh đóng được/lỗi (close_all). Lý do thêm: `no_match` (không lệnh nào khớp bộ lọc), `partial` (đóng được một phần), `bad_price`, `bad_symbol`, `no_money`.
- **close_all** chạy tối đa `TR_MAX_RUN_MS` = 8 giây (nhỏ hơn hạn dùng lệnh 15 giây) để kết quả kịp về trước khi Gateway báo `timeout`; quá thời gian thì báo `partial` kèm số liệu đã đóng.
- **Giao diện:** nút **Đặt lệnh** và **Đóng tất cả** ở đầu thẻ "Lệnh đang mở" (chỉ admin, liên kết đã bật giao dịch, terminal đang Live). Hộp Close All hiện trước số lệnh sẽ đóng và khóa nút xác nhận khi không lệnh nào khớp.
- **`trade_log` (migration 0011):** `op` nhận thêm `market`/`pending`/`close_all`; `ticket` có thể rỗng; thêm cột `symbol`, `kind` (hướng, loại lệnh chờ hoặc bộ lọc), `price`.

## `timeout` nghĩa là KHÔNG BIẾT
Quá hạn mà EA im thì kết quả là `timeout`: lệnh có thể đã chạy. FE nhắc xem lại bảng lệnh trước khi gửi lại. Kết quả muộn của EA vẫn được chuyển tiếp và ghi đè `timeout` (không ghi đè `done`).

## Phát hành
- **Pha 1:** Server 0.2.7, Gateway 0.3.5, EA 0.5.0 (0.2.6/0.3.4 chưa từng có tag).
- **Pha 2:** **Server 0.2.8, Gateway 0.3.6, EA 0.6.0**. EA tự biên dịch, không qua CI.

| Thành phần | Có thay đổi | Cách ra bản | Vì sao |
|---|---|---|---|
| Web (FE) trên VPS | Có (nút giao dịch, footer, hạn chờ FE; Pha 2: hộp Đặt lệnh, hộp Đóng tất cả) | `[release-server]` | Tunnel phục vụ giao diện từ VPS (`Server/src/static.ts`), nằm trong bộ cài Server |
| Server (BE + hub) | Có (route `/trade`, `sendTrade`, migration 0010; Pha 2: 3 op mới, kiểm EA >= 0.6.0, migration 0011) | `[release-server]` | Migration tự áp khi Server khởi động |
| Gateway | Có (nhận `trade`, trường `tr_*`, `/v1/trade_result`; Pha 2: `tr_sym`/`tr_side`/`tr_kind`/`tr_px`/`tr_filter`, kết quả `order`/`n_ok`/`n_fail`) | `[release]` | Gateway cũ không hiểu lệnh; bộ cài Server chỉ kèm Gateway cho máy Admin |
| Cloudflare Worker + D1 | Có (cùng mã BE, migration 0010 và 0011) | `[deploy]` | Giữ Worker cùng lược đồ với VPS; `deploy.yml` tự chạy `db:migrate:remote` trước khi deploy |
| EA | Có (`0.5.0`; Pha 2 `0.6.0`) | Không có tag | Compile bằng `ea/compile.ps1`, chép vào từng terminal |

Commit đủ bộ: ba tag cùng một message. Chỉ nhắc tới tag trong message mà không muốn chạy workflow thì đừng viết nguyên văn (xem `AZ_Sentinel_CI_Tags_And_Gateway_Power.md`).

Thứ tự áp dụng sau khi release: (1) cài Server mới (0.2.8) trên VPS chính (tự áp migration 0010 và 0011); (2) cài Gateway 0.3.6 trên MỌI VPS có terminal cần giao dịch; (3) compile EA 0.6.0, chép vào terminal; (4) bật `InpAllowRemoteTrading` (đóng lệnh, Close All) và, nếu muốn đặt lệnh mới, bật thêm `InpAllowRemoteOpen` (đặt `InpMaxRemoteVolume` phù hợp); (5) admin bật "Giao dịch từ xa" ở thẻ Tài khoản.

Lưu ý nâng cấp: EA 0.5.0 vẫn đóng/sửa lệnh được nhưng bị server từ chối Market, Pending, Close All (cần >= 0.6.0). Gateway cũ không hiểu lệnh Pha 2 nên phải cập nhật Gateway cùng lúc.

## Giới hạn đã biết
- **EA chưa từng được biên dịch hay chạy** ở môi trường phát triển. Test chỉ đọc mã nguồn EA để giữ các bất biến an toàn (xem dưới); chạy thử trên **demo** là bắt buộc.
- Route kiểm phiên bản EA (`>= 0.5.0`, Pha 2 `>= 0.6.0`) nhưng **chưa kiểm phiên bản Gateway**. Gateway cũ bỏ qua lệnh `trade`; FE không chờ mãi mà báo "không biết" sau `TRADE_CLIENT_WAIT_MS` (28 giây). Việc cần làm sau: hub nhớ `gw_ver` của `hello` và từ chối sớm.
- Chỉ dùng được khi chạy trên Server (VPS). Khi chạy dự phòng Cloudflare, route ghi bị chặn nên không giao dịch.
- **EA 0.6.0 chưa được biên dịch hay chạy trên MT5**; test chỉ đọc mã nguồn. Đường mở lệnh chỉ được phép nằm trong `RemoteMarket` và `RemotePending`, qua `OpenAllowed` (test `ea-trade-contract` giữ bất biến này).
- Close All đóng theo từng lệnh, không phải một giao dịch nguyên khối: có thể đóng được một phần (`partial`) khi thị trường đóng cửa hoặc hết thời gian chạy.
- Lệnh chờ không bị Close All hủy; chưa có thao tác hủy hay sửa lệnh chờ từ xa.

## Test tự động của tính năng
| Tệp | Nội dung |
|---|---|
| `Shared/test/trade-schema.test.ts` | Thân lệnh, kết quả EA, `CMD_ID`, hằng số an toàn, `eaVersionAtLeast`; Pha 2: market, pending (SL/TP đúng phía), close_all, `matchesCloseAll`, `minEaVerForOp`, `SYMBOL_RE`, `order`/`n_ok`/`n_fail` |
| `Gateway/test/trade.test.ts` | Giữ một lệnh mỗi terminal, hạn dùng, ân hạn `timeout`, từ chối ngay, mất cloud; Pha 2: trường `tr_*` mới, thiếu trường thì `bad_request`, kết quả mang `order`/`n_ok`/`n_fail` |
| `Gateway/test/ea-trade-contract.test.ts` | Đọc `ea/AZ_Spike.mq5`: công tắc mặc định tắt, ghi nhớ `cmd_id` TRƯỚC khi gọi sàn, kiểm hạn dùng, lệnh mở chỉ trong `RemoteMarket`/`RemotePending` qua `OpenAllowed`, `InpAllowRemoteOpen` mặc định tắt, `InpMaxRemoteVolume` <= 1, `close_all` chỉ `PositionClose` và `TR_MAX_RUN_MS` < hạn dùng, `reason` nằm trong schema; payload chép tay |
| `BE/test/integration/links-trade.test.ts` | Quyền, công tắc, thân lệnh, phiên bản EA, gửi lệnh, lệnh bận; Pha 2: thân lệnh mới, EA >= 0.6.0, cột `trade_log`, migration 0011 |
| `BE/test/integration/live-hub-trade.test.ts` | Hub chuyển lệnh (cả 3 op Pha 2), phát kết quả kèm `order`/`n_ok`/`n_fail`, nhật ký, `timeout` bị `done` ghi đè ngược lại |
| `BE/test/integration/trade-sync-isolation.test.ts` | `trade_enabled` không đồng bộ/ghi đè giữa VPS và Cloudflare; ràng buộc `trade_log` |
| `FE/src/features/links/trade-controls.test.tsx` | Nút, hộp xác nhận, kết quả thật, lỗi |
| `FE/src/features/links/order-controls.test.tsx` | Hộp Đặt lệnh (Market, Limit, Stop, chặn SL/TP sai phía), hộp Đóng tất cả (bộ lọc, đếm theo swap, khóa khi không khớp), kết quả `order`/`n_ok`/`n_fail` |
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
| T-12 | Để `InpAllowRemoteOpen = false`, bấm Đặt lệnh Market | Thất bại `remote_disabled`; không lệnh nào được mở |
| T-13 | Bật `InpAllowRemoteOpen`, đặt Market buy khối lượng nhỏ kèm SL/TP | Thành công, hiện ticket lệnh mới; lệnh xuất hiện đúng SL/TP |
| T-14 | Đặt Market với khối lượng lớn hơn `InpMaxRemoteVolume`; rồi mã giao dịch không có trên sàn | Từ chối (`bad_volume`, `bad_symbol`), không lệnh nào mở |
| T-15 | Đặt Buy Limit, Sell Stop với giá vào hợp lệ; rồi giá vào quá gần giá thị trường | Hai lệnh đầu thành công và hiện ticket; lần sau `bad_price`/`bad_stops` |
| T-16 | Có vài lệnh lãi, lỗ, Buy, Sell; chạy Close All lần lượt: Chỉ lãi, Chỉ lỗ, Chỉ Buy, Chỉ Sell, Tất cả | Mỗi lần chỉ đóng đúng nhóm; số "Đã đóng X lệnh, lỗi Y" khớp; lệnh chờ còn nguyên |
| T-17 | Chạy Close All khi không lệnh nào khớp (qua API hoặc để FE lệch dữ liệu) | `no_match`, không lệnh nào bị đóng |
| T-18 | Close All khi thị trường đóng cửa hoặc có lệnh bị sàn từ chối | `partial` hoặc lỗi kèm retcode, số đóng được/lỗi đúng |
| T-19 | Chạy EA 0.5.0 rồi bấm Đặt lệnh hoặc Đóng tất cả | Server từ chối 409, yêu cầu EA >= 0.6.0 |
