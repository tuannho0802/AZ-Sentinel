# CI theo tag commit và Bật/Tắt Gateway

## 1. Khi nào CI chạy

Ba workflow chỉ chạy khi **commit mới nhất** của lần push lên `main` có chứa tag trong message. Không có tag thì job bị bỏ qua ("skipped"), không tốn phút CI.

| Muốn làm gì | Tag trong message | Workflow | Kết quả |
|---|---|---|---|
| Deploy BE + FE lên Cloudflare | `[deploy]` | `.github/workflows/deploy.yml` | `pnpm check`, migration D1 remote, deploy API, deploy Web |
| Build bộ cài Gateway (exe) và tạo Release | `[release]` | `.github/workflows/release-gateway.yml` | Build `AZSentinel-Gateway-Setup.exe`, tạo GitHub Release `gateway-v<version>` |
| Build bộ cài Server (kèm giao diện web và `node.exe`) và tạo Release | `[release-server]` | `.github/workflows/release-server.yml` | Build `AZSentinel-Server-Setup.exe`, tạo GitHub Release `server-v<version>` |

Ví dụ: `git commit -m "update: add new feat [deploy]"`. Một commit có nhiều tag thì chạy từng workflow tương ứng. `[release-server]` không khớp `[release]` (và ngược lại), nên hai bộ cài không kích hoạt nhầm nhau.

Cả ba cũng có nút chạy tay (Actions > chọn workflow > Run workflow). Chạy tay `deploy` thì deploy luôn; chạy tay hai workflow release chỉ build và để file trong Artifacts, không tạo Release.

Lưu ý:

- Chỉ xét commit **cuối** của lần push. Push nhiều commit cùng lúc mà tag nằm ở commit đầu thì không chạy. Squash merge thì xét message của commit squash.
- Đừng viết nguyên văn `[deploy]`, `[release]` hay `[release-server]` vào message khi chỉ muốn **nhắc** tới chúng (ví dụ commit sửa chính tài liệu này), vì chuỗi con nào khớp cũng kích hoạt workflow. Viết "tag deploy" thay vì "[deploy]".
- Không phân biệt hoa thường (`[Deploy]` cũng khớp).

## 2. Deploy cần gì

Secret trong GitHub (Settings > Secrets and variables > Actions):

| Secret | Nội dung |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Token có quyền Workers Scripts:Edit và D1:Edit |
| `CLOUDFLARE_ACCOUNT_ID` | ID tài khoản Cloudflare |
| `D1_DATABASE_ID` | `database_id` thật của D1 `az-sentinel-db` |

`BE/wrangler.jsonc` trong repo giữ `database_id` giả (không commit ID thật). Workflow thay ID giả bằng `D1_DATABASE_ID` ngay trên bản checkout của runner rồi mới migrate và deploy. Thiếu secret thì workflow dừng ngay ở bước đầu với thông báo rõ.

Migration D1 chạy **trước** khi deploy API, nên migration phải tương thích ngược với bản API cũ đang chạy.

## 3. Release cần gì

Dùng chung cho hai bộ cài; khác nhau ở thư mục `package.json`, tag trong message và tiền tố release:

| | Gateway | Server (kèm giao diện web) |
|---|---|---|
| Tăng `version` trong | `Gateway/package.json` | `Server/package.json` |
| Tag trong commit | `[release]` | `[release-server]` |
| Release và tag Git | `gateway-v<version>` | `server-v<version>` |
| Tệp đính kèm | `AZSentinel-Gateway-Setup.exe`, `SHA256SUMS.txt` | `AZSentinel-Server-Setup.exe`, `SHA256SUMS.txt` |
| Kiểm trong CI | typecheck, test Gateway, chạy thử exe (`/v1/status`, `check-token`) | typecheck, test Server, chạy thử gói (`/api/health`, trang giao diện) |

Chi tiết: `AZ_Sentinel_Gateway_Installer.md` và `AZ_Sentinel_Server_Installer.md`.

- Phiên bản lấy từ `package.json` tương ứng (không lấy từ tag Git), nên phải tăng **trước** khi commit có tag release.
- Giao diện Gateway dựa vào tiền tố `gateway-v` để báo có bản mới; release Server dùng tiền tố `server-v` nên không lẫn vào.
- Release đã tồn tại thì workflow dừng ngay, không ghi đè bộ cài đã phát hành.

## 4. Bật/Tắt Gateway

Gateway chạy nền dưới tác vụ `AZ Gateway` (vòng lặp `run-gateway.cmd`, tài khoản SYSTEM).

**Tắt hoàn toàn từ giao diện:** mở `http://127.0.0.1:47800/`, bấm **Tắt hoàn toàn**, xác nhận. Gateway ghi file cờ `C:\ProgramData\AZSentinel\disabled.flag` rồi thoát. Trình giám sát thấy cờ thì không bật lại, **kể cả sau khi khởi động lại máy**. Nút chỉ hiện khi Gateway chạy dưới `run-gateway.cmd` (chạy tay hoặc `pnpm dev` thì không có).

**Bật lại:** bấm shortcut **AZ Gateway** (Desktop hoặc Start menu, có icon riêng). Shortcut chạy `scripts\start-gateway.ps1`:

- Gateway đang chạy: chỉ mở giao diện, không hỏi quyền.
- Gateway đang tắt: hiện hộp thoại UAC một lần (tác vụ SYSTEM cần quyền Administrator để bật), xóa cờ, bật tác vụ, đợi Gateway trả lời rồi mở giao diện.
- Tác vụ đang bị `Disable-ScheduledTask`: script báo lỗi kèm lệnh `Enable-ScheduledTask`, không tự bật lại.

**Cài mới / nâng cấp:**

- Nâng cấp khi Gateway đang tắt: giữ nguyên trạng thái tắt (đăng ký lại tác vụ nhưng không bật).
- Gỡ rồi cài lại: coi là cài mới, xóa cờ, Gateway tự chạy.

**Khi Gateway tắt:** mỗi EA tự về chế độ chỉ ghi nhận cục bộ trong vòng 15 giây, MT5 và giao dịch không bị ảnh hưởng. Web hiện terminal là Offline. Sự kiện đang chờ gửi nằm trong `queue.json`, bật lại là gửi tiếp. Sự kiện xảy ra lúc Gateway tắt hẳn thì EA không gửi được nên có thể thiếu.

Cổng khác 47800: thêm `-Port <số>` vào tham số của shortcut. Máy dev: nếu `pnpm dev` đang chạy Gateway ở cổng 47800 thì trùng với Gateway của bộ cài; tắt một bên trước khi dùng bên kia.
