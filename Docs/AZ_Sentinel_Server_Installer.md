# AZ Server: bộ cài cho Windows Server VPS (kèm giao diện web)

> v0.1 · 22/10/2026 · **Chưa thử trên Windows thật.** Phần Node/TypeScript đã có test; Inno Setup, Task Scheduler và các script PowerShell cần chạy thử trên một VPS Windows trước khi phát hành (mục 6).

## 1. Bộ cài làm gì

Một file `AZSentinel-Server-Setup.exe`, **không cần cài Node.js, Git hay pnpm trên VPS** (đã kèm `node.exe`). Giao diện web (FE) nằm trong cùng bộ cài: Server phục vụ thư mục `web\` ngay trên cổng của nó, không có bộ cài FE riêng.

1. Chép Server, `node.exe`, `migrations\`, `web\` và script vào `C:\Program Files\AZSentinel\Server`.
2. Hỏi: tên máy chủ, vị trí, cổng HTTP (mặc định 8080), địa chỉ Worker API dự phòng, URL web dự phòng, `SYNC_TOKEN` (>= 32 ký tự, trùng với Worker). Ghi vào `server.env` cạnh `server.mjs` (chỉ Administrators và SYSTEM đọc được).
3. Mặc định nghe `127.0.0.1` (đi qua Cloudflare Tunnel hoặc reverse proxy). Chọn "cho phép mạng nội bộ" thì `AZ_HOST=0.0.0.0`, và có thể mở luôn cổng trên Windows Firewall (chỉ mạng Private/Domain).
4. Đăng ký tác vụ **AZ Server** trong Task Scheduler: chạy lúc khởi động máy bằng SYSTEM, không cần đăng nhập RDP, tự bật lại.
5. Đợi `/api/health` trả lời rồi báo kết quả; tạo shortcut Start menu và Desktop mở giao diện.

Cài đè lên bản cũ được: bộ cài tự dừng bản đang chạy (đúng tiến trình `node.exe` nằm trong thư mục cài), thay `web\` và `migrations\` (tránh tệp giao diện cũ), **giữ nguyên `server.env` và cơ sở dữ liệu** (`C:\ProgramData\AZSentinelServer`). Migration mới tự chạy khi Server khởi động.

## 2. Token Gateway (không cấu hình trong bộ cài)

Token là của từng người, quản trị viên cấp sau khi cài. Start menu có **Quản lý token Gateway** (mở cửa sổ dòng lệnh quyền Administrator trong thư mục cài):

```
token issue <owner_id> <tên>   # cấp, token thô chỉ hiện MỘT lần
token list
token reset <id>
token revoke <id>
```

Gửi token cho đúng người đó để nhập vào bộ cài Gateway. CLI ghi thẳng SQLite nên Gateway đang nối bị từ chối ở lần nối lại kế tiếp (trang `/tokens` mới ngắt ngay). Xem `AZ_Sentinel_Gateway_Token.md`.

## 3. Cài im lặng

```
AZSentinel-Server-Setup.exe /VERYSILENT /NAME=VPS-MAIN /PORT=8080 ^
  /CLOUDURL=https://az-sentinel-api.<tài-khoản>.workers.dev ^
  /FALLBACKURL=https://az-sentinel-web.<tài-khoản>.workers.dev ^
  /SYNCTOKEN=<>=32 ký tự> [/LOCATION=Singapore] [/LAN=1] [/FIREWALL=1] [/RECONFIGURE=1]
```

Không có `/RECONFIGURE=1` thì `server.env` cũ được giữ (nâng cấp không hỏi lại). Có thì ghi lại toàn bộ `server.env` (tùy chọn nâng cao tự thêm tay sẽ mất, xem `server.env.example`).

## 4. Phát hành (GitHub Releases)

Giống Gateway nhưng workflow và tiền tố khác để hai bên không kích hoạt nhầm nhau:

1. Tăng `version` trong `Server/package.json`.
2. Commit lên `main` với message chứa `[release-server]`, ví dụ `feat(server): ... [release-server]`.
3. `.github/workflows/release-server.yml`: typecheck + test Server, build FE và Server (`pnpm pack:server`), kèm `node.exe`, **chạy thử gói** (kiểm `/api/health` và trang giao diện), build bộ cài Inno Setup, tính SHA256, tạo Release **AZ Server v<version>** (tag `server-v<version>`) kèm `AZSentinel-Server-Setup.exe` và `SHA256SUMS.txt`.

Release đã tồn tại thì workflow dừng, không ghi đè. Chạy tay (`workflow_dispatch`) chỉ đưa file vào Artifacts. Build tay: `pnpm pack:server`, chép `node.exe` vào `Server\release\az-server`, rồi `ISCC /DMyAppVersion=x.y.z Installer\az-server.iss` (kết quả ở `Server\release`).

## 5. Gỡ cài đặt

Gỡ tác vụ và quy tắc firewall. Giữ lại `C:\ProgramData\AZSentinelServer` (cơ sở dữ liệu, token, log). `server.env` nằm trong thư mục cài nên bị xóa theo: cài lại sẽ được hỏi cấu hình như cài mới (sao lưu trước nếu cần).

## 6. Danh sách kiểm trên VPS Windows trước khi dùng thật

- [ ] Bộ cài chạy (SmartScreen: chưa ký số), các trang nhập hiển thị đúng, giá trị sai (cổng, URL, SYNC_TOKEN ngắn) bị chặn.
- [ ] Task **AZ Server** đang *Running*; khởi động lại VPS, Server tự lên khi chưa đăng nhập RDP.
- [ ] `http://127.0.0.1:<cổng>/` mở được giao diện; `/api/health` trả `ok`.
- [ ] `server.env` chỉ Administrators/SYSTEM đọc được (`icacls`), cơ sở dữ liệu cũng vậy.
- [ ] "Quản lý token Gateway" xin UAC, `token issue 1 Test` in token `azt_...`; Gateway cài bằng token đó nối được.
- [ ] Cài đè bản mới: `server.env` và dữ liệu còn nguyên, không còn `node.exe` cũ, giao diện là bản mới.
- [ ] Chọn LAN + Firewall: máy khác trong LAN vào được; gỡ cài đặt thì quy tắc "AZ Server" biến mất.

## 7. Tệp liên quan

| Đường dẫn | Việc |
|---|---|
| `Installer/az-server.iss` | Script Inno Setup (trang cấu hình, nâng cấp tại chỗ, cài im lặng) |
| `Server/scripts/pack.mjs` | Gom `server.mjs`, `migrations\`, `web\` (FE/dist), script vào `Server\release\az-server` |
| `Server/scripts/install-task.ps1`, `run-server.cmd` | Đăng ký tác vụ và vòng lặp giám sát |
| `Server/scripts/token.cmd`, `token-shell.ps1` | Quản lý token (dòng lệnh, tự xin quyền Administrator) |
| `Server/scripts/stop-server.ps1`, `open-firewall.ps1`, `check-server.ps1` | Dừng bản cũ, mở/gỡ firewall, đợi Server lên |
| `.github/workflows/release-server.yml` | Build và phát hành theo `[release-server]` |
