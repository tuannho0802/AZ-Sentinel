# AZ Gateway: bộ cài cho Windows Server VPS và cách phát hành bản cập nhật

> v0.2 · 22/10/2026 (token cá nhân, kiểm token lúc cài) · v0.1 · 21/10/2026 · Hiện thực mục 7 của `AZ_Sentinel_Plan3C_Local_Gateway.md`.
> **Chưa thử trên Windows thật.** Phần Node/TypeScript (test, bundle, đóng gói exe) đã chạy và kiểm trên Linux; Inno Setup, Task Scheduler và script PowerShell cần chạy thử trên một VPS Windows trước khi phát hành chính thức (xem mục 6).

## 1. Bộ cài làm gì

Một file `AZSentinel-Gateway-Setup.exe` (khoảng 30-40 MB sau nén, **không cần cài Node.js, Git hay pnpm trên VPS**):

1. Chép `az-gateway.exe` (Node SEA, một file) vào `C:\Program Files\AZSentinel\Gateway`.
2. Hỏi: tên VPS, Cloud URL, Cloud URL dự phòng (tùy chọn) và **token cá nhân `azt_...`** (quản trị viên cấp riêng cho từng người, xem `AZ_Sentinel_Gateway_Token.md`). Token được kiểm ngay trên trang nhập (xem mục 1a). Ghi vào `C:\ProgramData\AZSentinel\config.json` (chỉ Administrators và SYSTEM đọc được). Có thể để trống rồi nhập sau trên giao diện web.
3. Đăng ký tác vụ **AZ Gateway** trong Task Scheduler: chạy lúc khởi động máy bằng tài khoản SYSTEM, không cần đăng nhập RDP, tự bật lại nếu thoát. Nhẹ hơn Windows Service dựng bằng thư viện ngoài và không cần tải thêm gì.
4. Tìm các terminal MT5 **đang chạy** và chép EA (`*.ex5` trong `Installer\ea`) vào `MQL5\Experts\AZ` của từng terminal.
5. Tạo shortcut Start menu và Desktop mở giao diện `http://127.0.0.1:47800/`.

### 1a. Kiểm token lúc cài
- Sai hình dạng (không phải `azt_...`, kể cả khóa chung cũ): báo lỗi, không cho đi tiếp.
- Bộ cài gọi `az-gateway.exe check-token <url> <token>` (Gateway gọi `GET /api/gw/check`). Mã thoát: `0` hợp lệ, `1` cloud từ chối (sai, đã thu hồi hoặc đã đặt lại) thì chặn, `2` không hỏi được cloud (mạng, địa chỉ sai) thì hỏi có tiếp tục không, `3` đầu vào sai.
- Cài im lặng (`/VERYSILENT`) cũng kiểm ở bước chuẩn bị: bị từ chối (mã 1) thì dừng cài. Muốn cài bất chấp (cloud chưa sẵn sàng) thêm `/SKIPTOKENCHECK=1`.
- Không nhập token hoặc không nhập Cloud URL vẫn cài được (chạy cục bộ), nhập sau trên giao diện web; ô token trên giao diện cũng chỉ nhận `azt_...`.
- **Nâng cấp từ bản dùng khóa chung cũ**: nếu `config.json` có Cloud URL mà token không phải `azt_...`, bộ cài hiện lại trang nhập, khóa các ô khác và chỉ đòi token cá nhân mới; chỉ thay giá trị `cloudToken`, các khóa khác (cổng, thời gian giữ sự kiện...) giữ nguyên.

Cài đè lên bản cũ được: bộ cài tự dừng bản đang chạy, giữ nguyên `config.json` và hàng đợi, rồi chạy lại.

## 2. Giao diện Gateway (mở bằng shortcut hoặc trình duyệt trên VPS)

- Thẻ tóm tắt: kết nối cloud, số terminal online, số terminal đang được xem, hàng đợi sự kiện, thời gian chạy.
- Bảng terminal (tài khoản, server, EA, online/mất broker, ghép nối, thời gian thấy lần cuối).
- Mục **Cài đặt**: sửa tên VPS, Cloud URL, token, thời gian giữ sự kiện, rồi bấm *Lưu và khởi động lại* (không cần mở file). Token không bao giờ được gửi ngược về trình duyệt.
- **Nhật ký**: 200 dòng log cuối, tự cập nhật. File log thật nằm ở `C:\ProgramData\AZSentinel\logs` (xoay vòng 5 tệp × 1 MB).
- **Sao chép chẩn đoán**: trạng thái, cấu hình (không có token) và 60 dòng log, để dán cho người hỗ trợ.
- Biểu ngữ vàng khi GitHub có bản Gateway mới (kiểm tra 6 giờ một lần, chỉ thông báo, không tự cập nhật).

Cổng chỉ nghe `127.0.0.1`. Các thao tác ghi (lưu cấu hình, khởi động lại) đòi header `x-az-ui` và `Origin` đúng, để trang web lạ mở trên VPS không sửa được cấu hình.

## 3. Việc thủ công mỗi terminal (một lần)

Bộ cài không tự làm được vì MT5 ghi đè cấu hình khi đang chạy:

1. MT5: *Tools > Options > Expert Advisors* > bật **Allow WebRequest for listed URL** > thêm `http://127.0.0.1:47800`.
2. Kéo EA từ *Navigator > Expert Advisors > AZ* vào một chart, bật **Algo Trading**.

Mở terminal mới sau khi cài thì chạy *Start menu > AZ Gateway > Chép EA vào các terminal*.

## 4. Chuẩn bị EA để bộ cài chép

CI trên GitHub không có MetaEditor nên không biên dịch EA được. Biên dịch trên máy bạn rồi commit file `.ex5`:

```powershell
powershell -NoProfile -File ea/compile.ps1 -Source ea/AZ_Spike.mq5
copy ea\AZ_Spike.ex5 Installer\ea\
git add Installer/ea/AZ_Spike.ex5
```

(`.gitignore` đã mở ngoại lệ cho `Installer/ea/*.ex5`.) Khi sửa EA thì biên dịch lại, chép đè, commit, rồi phát hành bản mới. Không có `.ex5` thì bộ cài vẫn cài Gateway bình thường, chỉ bỏ qua bước chép EA.

## 5. Phát hành và cập nhật bộ cài lên Git (GitHub Releases)

File `.exe` **không commit vào repo** (to, và `dist/` đã bị ignore). Nó được đính kèm vào **GitHub Release**; CI build tự động.

### Cách A (khuyến nghị): đẩy tag, CI làm hết

```powershell
# 1. Sửa mã, commit, push lên main như thường
# 2. Đặt phiên bản (tùy chọn, cho khớp): Gateway/package.json "version": "0.2.0"
git tag gateway-v0.2.0
git push origin gateway-v0.2.0
```

Workflow `.github/workflows/release-gateway.yml` (tab **Actions** trên GitHub) sẽ: cài phụ thuộc, chạy typecheck và test Gateway, build `az-gateway.exe`, **chạy thử exe và kiểm phiên bản**, build bộ cài bằng Inno Setup, tính SHA256, rồi tạo Release **AZ Gateway v0.2.0** kèm `AZSentinel-Gateway-Setup.exe` và `SHA256SUMS.txt`. Mất khoảng 4-6 phút. Số phiên bản lấy từ tên tag và được gắn vào exe (hiện ở giao diện và trong `hello` gửi cloud).

Sai tag hoặc build lỗi: xóa tag rồi làm lại.

```powershell
git tag -d gateway-v0.2.0
git push origin :refs/tags/gateway-v0.2.0
```

### Cách B: build tay trên máy Windows có Inno Setup 6

```powershell
pnpm install
pnpm build:gateway                       # tạo Gateway\dist\az-gateway.exe
& "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe" /DMyAppVersion=0.2.0 Installer\az-gateway.iss
gh release create gateway-v0.2.0 Gateway\dist\AZSentinel-Gateway-Setup.exe --title "AZ Gateway v0.2.0" --generate-notes
```

(Cần GitHub CLI `gh`, hoặc tạo Release trên web rồi kéo file vào.)

### Cập nhật Gateway trên VPS

1. Vào trang *Releases* của repo, tải `AZSentinel-Gateway-Setup.exe` bản mới nhất (kiểm SHA256 nếu muốn: `Get-FileHash .\AZSentinel-Gateway-Setup.exe`).
2. Kéo vào VPS, chạy. Cấu hình cũ giữ nguyên, không bị hỏi lại.
3. Cài im lặng cho nhiều VPS: `AZSentinel-Gateway-Setup.exe /VERYSILENT /VPS=VPS-05 /CLOUDURL=wss://... /TOKEN=azt_... [/FALLBACKURL=wss://...] [/SKIPTOKENCHECK=1]`. Mỗi người một token riêng: đừng dùng chung một token cho nhiều người.

Repo public nên link tải dạng `https://github.com/tuannho0802/AZ-Sentinel/releases/latest` dùng được ngay, và biểu ngữ "có bản mới" trên giao diện hoạt động. Nếu sau này chuyển repo sang private, biểu ngữ sẽ không hiện (không có token); lúc đó phải đổi cách phân phối.

## 6. Danh sách kiểm trên VPS Windows trước khi dùng thật

Các mục chưa thể kiểm trên Linux:

- [ ] Bộ cài chạy, mở khóa SmartScreen ("More info > Run anyway"; chưa ký số, xem Plan 3C Part 4).
- [ ] Task **AZ Gateway** có trong Task Scheduler và đang *Running*; khởi động lại VPS, Gateway tự lên mà chưa đăng nhập RDP.
- [ ] `http://127.0.0.1:47800/` mở được; lưu cấu hình, Gateway tự khởi động lại và vẫn giữ giá trị.
- [ ] `install-ea.ps1` tìm đúng terminal đang chạy (so với *File > Open Data Folder* của MT5), kể cả khi terminal chạy ở phiên RDP/user khác.
- [ ] EA thấy được Gateway sau khi thêm URL vào Allow WebRequest, terminal hiện trong bảng.
- [ ] Cài đè bản mới: không mất config, không còn tiến trình `az-gateway.exe` cũ.
- [ ] Gỡ cài đặt: task biến mất; `C:\ProgramData\AZSentinel` vẫn còn (cố ý, để cài lại không phải nhập lại).

## 7. Xử lý sự cố

| Triệu chứng | Kiểm |
|---|---|
| Giao diện không mở | Task Scheduler: *AZ Gateway* có chạy không. Xem `C:\ProgramData\AZSentinel\startup-error.txt` (lỗi cấu hình, cổng 47800 bị chiếm) |
| "Mất kết nối" cloud | Cloud URL/token trong *Cài đặt*; xem mục Nhật ký. Log ghi "token Gateway đã bị thu hồi hoặc đặt lại" thì xin quản trị viên token mới và nhập vào *Cài đặt* |
| Terminal không xuất hiện | Allow WebRequest chưa thêm URL, hoặc EA chưa gắn chart / chưa bật Algo Trading |
| Biểu ngữ báo bản mới nhưng không muốn nâng | Bỏ qua, không ảnh hưởng chạy |

## 8. Tệp liên quan

| Đường dẫn | Việc |
|---|---|
| `Gateway/packaging/bundle.mjs`, `sea.mjs` | Gom một file `.cjs` bằng esbuild, đóng gói thành `az-gateway.exe` bằng Node SEA |
| `Installer/az-gateway.iss` | Script Inno Setup (trang nhập cấu hình, kiểm token, nâng cấp tại chỗ, cài im lặng) |
| `Gateway/src/check-token.ts` | Lệnh `az-gateway.exe check-token` mà bộ cài gọi |
| `Installer/run-gateway.cmd` | Vòng lặp giám sát, bật lại Gateway khi thoát |
| `Installer/scripts/*.ps1` | Đăng ký/gỡ tác vụ, phát hiện terminal và chép EA |
| `.github/workflows/release-gateway.yml` | Build và phát hành tự động theo tag `gateway-v*` |
| `Gateway/src/status-page.ts`, `local-server.ts` (`/v1/ui/*`) | Giao diện và API giao diện |
| `Gateway/src/log.ts` (`createFileSink`), `config.ts` (`saveEditableConfig`), `update-check.ts` | Log xoay vòng, lưu cấu hình, báo bản mới |
