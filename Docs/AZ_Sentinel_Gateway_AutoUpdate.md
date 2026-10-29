# Server ép Gateway đồng bộ bản mới (tự cập nhật Gateway)

Từ Gateway 0.4.0 và Server 0.3.0, người dùng không phải chạy lại `AZSentinel-Gateway-Setup.exe` mỗi lần có bản Gateway mới. **Server** thấy bản mới trên GitHub Releases rồi **bảo Gateway** tự tải, kiểm băm và khởi động lại bằng bản mới.

> **Trạng thái:** logic Node/TypeScript có test tự động (Shared, Gateway, Server). Phần `run-gateway.cmd` (thay file, trả bản cũ), bộ cài Inno Setup và workflow release **chưa chạy trên Windows thật**; xem mục 7 để tự kiểm.

## 1. Luồng

```
 GitHub Releases ──(Server hỏi mỗi 5 phút, ETag)──► Server (UpdateAgent)
   gateway-v0.4.0                                        │  thấy gateway-v0.4.0 có az-gateway.exe + SHA256SUMS.txt
   ├─ AZSentinel-Gateway-Setup.exe                       │  tải SHA256SUMS.txt, lấy băm của az-gateway.exe
   ├─ az-gateway.exe          ◄────────┐                 ▼
   └─ SHA256SUMS.txt                   │          LiveHub gửi {t:"update", min_ver, url, sha256}
                                       │             · cho Gateway vừa `hello` mà cũ hơn
                                       │             · cho mọi Gateway đang nối khi vừa thấy bản mới
                                       │                      │
                                       └── Gateway tải ◄──────┘
                                            1. url phải đúng .../releases/download/gateway-v<min_ver>/az-gateway.exe
                                            2. kiểm SHA-256 + dấu MZ  →  ghi az-gateway.exe.new
                                            3. thoát bình thường
                                       run-gateway.cmd: exe → .old, .new → exe, chạy exe mới (cờ .trial)
                                            4. chạy ổn định 30 giây → xóa .old và .trial
```

- Worker Cloudflare dự phòng **không** ép cập nhật (không có `HOST`); chỉ Server VPS làm việc này.
- Gateway cũ (chưa có tính năng này) nhận `update` chỉ ghi log và bỏ qua: **phải cài tay một lần** lên 0.4.0, các lần sau tự động.

## 2. An toàn

| Rủi ro | Cách chặn |
|---|---|
| Server/hub bị chiếm, đưa địa chỉ lạ | Gateway chỉ chấp nhận đúng `https://github.com/tuannho0802/AZ-Sentinel/releases/download/gateway-v<min_ver>/az-gateway.exe` (dựng lại từ `@az-sentinel/shared`, không tin `url` do Server gửi); chuyển hướng chỉ được tới `github.com` hoặc `*.githubusercontent.com` |
| File tải hỏng hoặc bị thay | Kiểm SHA-256 (băm lấy từ `SHA256SUMS.txt` của chính release) và dấu `MZ`; sai thì xóa file tải dở, giữ bản đang chạy |
| Hạ cấp | Chỉ nhận `min_ver` mới hơn bản đang chạy |
| Bản mới không khởi động được | `run-gateway.cmd` đếm số lần exe thoát khi còn cờ `.trial`; 3 lần liên tiếp thì trả `.old` về và ghi `update-failed.txt`. Gateway không nhận lại phiên bản đó (hay cũ hơn) nữa |
| Tải hỏng lặp lại | Cùng phiên bản chỉ thử lại sau 10 phút |
| Chạy tay, `pnpm dev`, bản không đóng gói | Không tự cập nhật (cần `GW_BUILD_VERSION`, `az-gateway.exe` trên Windows và chạy dưới `run-gateway.cmd`) |

## 3. Tắt hoặc điều chỉnh

| Muốn | Cách |
|---|---|
| Server không ép nữa (chỉ banner) | `AZ_GATEWAY_AUTO_UPDATE=0` trong `server.env`, khởi động lại Server |
| Một Gateway không nhận lệnh | `"autoUpdate": false` trong `%ProgramData%\AZSentinel\config.json`, hoặc biến môi trường `AZ_GW_AUTO_UPDATE=0` |
| Server không hỏi GitHub | `AZ_UPDATE_CHECK=0` (tắt luôn cả banner) |

## 4. Quy ước phát hành (bắt buộc)

- Release Gateway phải đính kèm **`az-gateway.exe`** và **`SHA256SUMS.txt`** (có dòng `<băm>  az-gateway.exe`). `.github/workflows/release-gateway.yml` đã làm việc này; **đừng đổi tên hai file**. Release cũ chỉ có bộ cài bị Server bỏ qua.
- Tăng `version` trong `Gateway/package.json` như trước (chỉ bản **mới hơn** mới được ép).
- Muốn đẩy bản Gateway mới tới mọi người: chỉ cần phát hành (`[release]`). Server của Admin tự thấy trong tối đa 5 phút và ép các Gateway đang nối.
- Sửa `Server/` hay `BE/` thì vẫn cần `[release-server]` và Admin chạy bộ cài Server như trước (Server chưa tự cập nhật chính nó).

### Xử lý lỗi (đã có test)

| Sự cố | Cách xử lý |
|---|---|
| Mất mạng, timeout, HTTP lỗi, thân rỗng | Giữ bản đang chạy, không để lại file; chờ 10 phút mới thử lại cùng phiên bản |
| Đứt giữa chừng, vượt trần 300 MB, file không phải exe, băm sai | Xóa `.part`; không tạo `.new`; bản chờ hợp lệ của lần trước (nếu có) giữ nguyên |
| `.new` còn lại nhưng nội dung hỏng/cụt | Không dùng lại: kiểm lại SHA-256 rồi tải lại |
| Đổi tên lỗi giữa chừng | Cặp `.new` + `.new.ver` cũ bị xóa trước khi ghi cặp mới, không có `.new` cũ mang nhãn của bản mới |
| `run-gateway.cmd` không thay được file (antivirus khóa, thiếu quyền): Gateway cũ chạy lại, Server nhắc lại | Tối đa 3 lần khởi động lại cho cùng một phiên bản trong 6 giờ (`update-attempt.json` trong thư mục dữ liệu), sau đó log cảnh báo và dừng; bản mới hơn hoặc hết 6 giờ thì thử lại |
| Bản mới khởi động lỗi 3 lần | `run-gateway.cmd` trả bản cũ về, ghi `update-failed.txt`, Gateway không nhận lại bản đó |
| Server: không lấy được `SHA256SUMS.txt` | Không ép; cảnh báo một lần; thử lại sớm |
| Server: release Gateway bị xóa | Offer bị rút lại (không giữ địa chỉ tải đã chết) |
| Server: hub lỗi khi được báo bản mới | Ghi cảnh báo riêng; offer vẫn giữ |

## 5. Tệp liên quan

| Tệp | Việc |
|---|---|
| `Shared/src/update-check.ts` | `gatewayAssetUrl`, `sha256SumsUrl`, `parseSha256Sums`, `latestGatewayRelease` |
| `Shared/src/gw-schema.ts` | tin `update {min_ver, url, sha256}` (đã có từ Plan 3C) |
| `Server/src/update-agent.ts` | tìm bản Gateway mới và băm; gọi hub khi có |
| `BE/src/live/live-hub.ts` | `offerGatewayUpdate` (sau `hello`), `pushGatewayUpdate` (khi có bản mới) |
| `Gateway/src/self-update.ts` | tải, kiểm, đặt `az-gateway.exe.new`, yêu cầu khởi động lại, `markHealthy` |
| `Installer/run-gateway.cmd` | thay file trước khi chạy, canh bản mới, trả bản cũ |
| `Installer/az-gateway.iss` | `[InstallDelete]` dọn file cập nhật dở khi cài đè |

## 6. Cài lại một lần (chuyển sang bản có tự cập nhật)

1. Xóa các release và tag cũ của Server và Gateway trên GitHub (tùy chọn; nên làm để Server không thấy bản cũ không có `az-gateway.exe`).
2. Tăng version (Gateway 0.4.0, Server 0.3.0), commit có tag `[release]` và `[release-server]`.
3. Admin chạy `AZSentinel-Server-Setup.exe`; mỗi người dùng chạy `AZSentinel-Gateway-Setup.exe` (cấu hình cũ giữ nguyên, không hỏi lại mã).
4. Từ đó phát hành Gateway mới chỉ cần `[release]`.

## 7. Cách tự kiểm trên Windows thật (CHƯA CHẠY)

1. Cài Gateway 0.4.0 và Server 0.3.0, nối Gateway vào Server. Phát hành `gateway-v0.4.1` (chỉ cần đổi `version`).
2. Trong 5 phút, log Server có `sẽ ép Gateway cũ hơn cập nhật lên v0.4.1` và `đã ép 1 Gateway...`.
3. Log Gateway (`%ProgramData%\AZSentinel\logs\gateway.log`): `Server yêu cầu cập nhật...`, `đã tải và kiểm băm`, rồi `AZ Gateway v0.4.1 khởi động`; sau 30 giây: `đã chạy ổn định sau cập nhật`.
4. Thư mục cài không còn `.new`, `.old`, `.trial`.
5. Thử hỏng: đặt tạm một `az-gateway.exe.new` là file rác cùng `az-gateway.exe.trial` rồi để `run-gateway.cmd` chạy: sau 3 lần thoát liên tiếp phải thấy exe cũ trở lại và `update-failed.txt`.
