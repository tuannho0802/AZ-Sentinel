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

### Chọn tag theo thư mục đã đổi

| Thư mục có thay đổi | Cần tag | Ghi chú |
|---|---|---|
| `FE/` | `[release-server]` (VPS), `[deploy]` (Worker) | Tunnel phục vụ FE từ VPS; không có `[release-server]` thì VPS vẫn chạy giao diện cũ |
| `BE/`, `Shared/` | `[release-server]` + `[deploy]` | Cả hai chạy cùng mã BE; có migration thì cần cả hai để lược đồ khớp |
| `BE/migrations/` | `[deploy]` tự chạy migration D1; Server tự áp khi khởi động | Migration phải tương thích ngược với bản đang chạy |
| `Server/` | `[release-server]` | Tăng `version` trong `Server/package.json` |
| `Gateway/` | `[release]` | Tăng `version` trong `Gateway/package.json`; `[release-server]` chỉ kèm Gateway cho máy Admin |
| `ea/` | Không có | Compile lại và chép vào terminal; không qua CI |
| `Docs/` | Không | Đừng viết nguyên văn tag trong message |

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
| Tệp đính kèm | `AZSentinel-Gateway-Setup.exe`, `az-gateway.exe` (Server dùng để ép Gateway tự cập nhật, [chi tiết](AZ_Sentinel_Gateway_AutoUpdate.md)), `SHA256SUMS.txt` | `AZSentinel-Server-Setup.exe`, `SHA256SUMS.txt` |
| Kiểm trong CI | typecheck, test Gateway, chạy thử exe (`/v1/status`, `check-token`) | typecheck, test Server, chạy thử gói (`/api/health`, trang giao diện) |

Chi tiết: `AZ_Sentinel_Gateway_Installer.md` và `AZ_Sentinel_Server_Installer.md`.

- Phiên bản lấy từ `package.json` tương ứng (không lấy từ tag Git), nên phải tăng **trước** khi commit có tag release.
- Release đã tồn tại thì workflow dừng ngay, không ghi đè bộ cài đã phát hành.

### Báo bản cập nhật cho người dùng

Hai bộ cài tự hỏi GitHub Releases, không cần cấu hình gì thêm và không có bước nào phải làm trong workflow (chỉ cần release đúng tên tag ở bảng trên):

| | Gateway | Server |
|---|---|---|
| Tìm tag | `gateway-v*` | `server-v*` |
| Hỏi GitHub | Khi khởi động, rồi mỗi 5 phút | Khi khởi động, rồi mỗi 5 phút |
| Banner hiện ở | Trang `http://127.0.0.1:47800/` của Gateway (trang hỏi lại mỗi 30 giây) | Giao diện web do VPS phục vụ, **chỉ cho Admin**; nút "Để sau" ẩn đúng phiên bản đó |
| Tắt | Chạy chưa đóng gói (`pnpm dev`) thì không hỏi | `AZ_UPDATE_CHECK=0` trong `server.env`; chạy dev thì không hỏi |

- Tiền tố `gateway-v` và `server-v` tách riêng hai bộ cài nên không lẫn vào nhau. Bản nháp (draft), bản thử (prerelease) và tag không đúng dạng `x.y.z` bị bỏ qua.
- Request có ETag nên khi không có release mới GitHub trả 304 (không tính vào hạn mức 60 request/giờ/IP). Mất mạng thì thử lại sau 2 phút; hết hạn mức (403/429) thì chờ đủ một chu kỳ. Lỗi được ghi vào log (`gateway.log` / `server.log`) một lần mỗi loại lỗi.
- Banner chỉ nhắc, không tự tải hay tự cài: người dùng tải bộ cài mới và chạy đè (giữ nguyên cấu hình và dữ liệu).
- Giao diện qua Cloudflare Worker (`workers.dev`) không có banner này: Worker được triển khai bằng `[deploy]`, không dùng bộ cài.
- Giới hạn hiện tại: máy chủ không biết từng Gateway của người dùng đang chạy bản nào (hub không lưu `gw_ver`), nên banner Gateway chỉ hiện trên trang cục bộ của chính Gateway đó.

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

## Deploy Cloudflare báo `[code: 10013] An unknown error has occurred`
Lỗi nằm ở API của Cloudflare lúc Wrangler mở phiên upload assets (`assets-upload-session`), thường là tạm thời; build, test và migration D1 phía trước vẫn đã xong. `deploy.yml` tự thử lại bước Deploy API và Deploy Web tối đa 3 lần (nghỉ 20 rồi 40 giây); chạy lại an toàn vì migration đã áp và file assets đã lên được bỏ qua theo hash. Nếu cả 3 lần đều hỏng: (1) xem https://www.cloudflarestatus.com; (2) kiểm tra `CLOUDFLARE_API_TOKEN` còn hiệu lực và có quyền Workers Scripts:Edit (và D1:Edit cho bước migration); (3) bấm **Re-run failed jobs** hoặc chạy tay (`workflow_dispatch`) sau ít phút.

