# AZ Sentinel — Hướng dẫn setup môi trường local

> v0.1 · 20/10/2026 · Ưu tiên Windows 11 (máy phát triển và MT5). Ghi chú macOS/Linux ở cuối mỗi mục khi khác.
> Làm xong mục 1-3 và tick Gate 0 trong `AZ_Sentinel_Plan3_Implementation.md` trước khi bắt đầu Part 1.

## 1. Yêu cầu hệ thống

- **Wrangler (công cụ dòng lệnh của Cloudflare) chỉ hỗ trợ macOS 13.5 trở lên, Windows 11 và Linux có glibc 2.35 trở lên.** Windows 10 không nằm trong danh sách hỗ trợ: nếu đang dùng Windows 10, hãy dùng WSL2 (Ubuntu) hoặc nâng cấp.
- Đường dẫn dự án ngắn, **ngoài OneDrive/Dropbox** (ví dụ `C:\dev\az-sentinel`). Thư mục đồng bộ đám mây làm chậm và đôi khi làm hỏng `node_modules` và thư mục `.wrangler`.
- Cổng cần trống: **5173** (web) và **8787** (API).
- MT5 chạy trên Windows; nếu máy phát triển không phải Windows, cần một máy/VPS Windows để thử EA.

## 2. Cần tải và cài

### Bắt buộc

| # | Công cụ | Tải ở đâu | Ghi chú |
|---|---|---|---|
| 1 | **Git** | https://git-scm.com | Cài mặc định |
| 2 | **Tài khoản GitHub** | https://github.com | Tạo repo private cho dự án |
| 3 | **Node.js (bản LTS mới nhất)** | https://nodejs.org | Wrangler hỗ trợ các bản Current, Active và Maintenance; chọn LTS để ổn định. Cài kèm npm |
| 4 | **pnpm** | cài bằng lệnh ở mục 2.1 | Quản lý gói của monorepo |
| 5 | **Visual Studio Code** | https://code.visualstudio.com | Trình soạn thảo |
| 6 | **Tài khoản Cloudflare (free)** | https://dash.cloudflare.com/sign-up | Cần cho D1 và deploy |
| 7 | **MetaTrader 5** + tài khoản **demo** | từ trang của broker | MetaEditor đi kèm MT5 |

### Nên có

| Công cụ | Dùng để |
|---|---|
| **Windows Terminal** (Microsoft Store) | Cửa sổ dòng lệnh dễ dùng hơn |
| **Bruno** (https://www.usebruno.com) hoặc Postman | Gọi thử API bằng tay (không bắt buộc, vì đã có script `fake-ea.ts`) |
| **DB Browser for SQLite** | Xem trực tiếp tệp SQLite local của D1 trong `.wrangler/` |

### Chưa cần (đừng cài vội)

- Docker, Python, PostgreSQL/MySQL local, Wrangler cài toàn cục (Wrangler được cài **trong dự án** để mọi người dùng cùng một phiên bản).
- **Domain riêng:** chưa cần cho local và Part 1-3; cần trước Part 4 (xem Plan 3 mục 1).

### Tiện ích VS Code nên cài

- Biome (`biomejs.biome`) — định dạng và lint
- Tailwind CSS IntelliSense (`bradlc.vscode-tailwindcss`)
- Markdown All in One — để đọc và tick các file Plan
- SQLite Viewer — xem tệp `.sqlite` (tùy chọn)

### 2.1 Cài pnpm

Mở Windows Terminal (PowerShell) sau khi cài Node.js:

```powershell
npm install -g pnpm
```

Nếu PowerShell báo bị chặn chạy script (“running scripts is disabled”), chạy một lần:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

## 3. Kiểm tra sau khi cài

Mở cửa sổ dòng lệnh **mới** và chạy lần lượt. Mỗi lệnh phải in ra số phiên bản, không báo lỗi:

```powershell
git --version
node -v
npm -v
pnpm -v
```

Đây chính là “bằng chứng” cho mục P1-01 trong Plan 3.

## 4. Cấu hình Git một lần

```powershell
git config --global user.name "Tên của bạn"
git config --global user.email "email-dung-cho-github@example.com"
git config --global core.autocrlf input
git config --global core.longpaths true
git config --global init.defaultBranch main
```

Dự án sẽ có tệp `.gitattributes` ép ký tự xuống dòng kiểu LF để tránh lỗi lệch dòng giữa Windows và Cloudflare.

## 5. Tạo repo và thư mục làm việc

1. Trên GitHub, tạo repo **private** rỗng (ví dụ `az-sentinel`), không thêm README.
2. Clone về máy ở đường dẫn ngắn:

```powershell
mkdir C:\dev
cd C:\dev
git clone https://github.com/<tai-khoan-cua-ban>/az-sentinel.git
cd az-sentinel
code .
```

3. Thư mục này sẽ chứa toàn bộ monorepo (`apps/api`, `apps/web`, `packages/shared`, `ea`, `docs`, `scripts`) theo Plan 3 mục 1.
4. Chép 5 file kế hoạch/quy tắc (`.md`) vào thư mục `docs/` để tiện đối chiếu.

## 6. Tài khoản Cloudflare

1. Đăng ký tại https://dash.cloudflare.com/sign-up bằng email của bạn và xác thực email.
2. Bạn **chưa cần** làm gì thêm ở dashboard. Ở Part 1 (mục 1.F) chúng ta sẽ đăng nhập Wrangler (`wrangler login` mở trình duyệt để cấp quyền) và tạo D1.
3. Không cần thêm domain vào Cloudflare ở giai đoạn này.
4. Token Gateway (Plan 4): không còn khóa chung `GW_CONNECT_TOKEN`. Mỗi người dùng một token cá nhân `azt_...`, chỉ có tác dụng với người đó; xem `AZ_Sentinel_Gateway_Token.md` để cấp, đặt lại, thu hồi. Khi chạy `pnpm dev`, Server dev tự cấp sẵn token `azt_dev0123456789abcdef0123456789ab` cho người dùng dev (id 1) và Gateway dev dùng đúng token đó. Nhớ chạy migration `0004` (`pnpm db:migrate:remote`) trước khi deploy.

## 7. Chuẩn bị MT5 (để thử EA ở Part 1.G)

1. Cài MT5 từ trang của broker, mở **tài khoản demo** và đăng nhập được.
2. Mở MetaEditor (phím F4 trong MT5) để chắc chắn mở được.
3. Cho phép WebRequest (làm khi tới bước P1-27): Tools → Options → tab Expert Advisors → bật **Allow WebRequest for listed URL** → thêm URL của API.
4. Bật nút **Algo Trading** trên thanh công cụ MT5 khi chạy EA.
5. Mẹo: sau này, nếu MT5 chạy cùng máy với API local, có thể thử `http://127.0.0.1:8787` (mục P1-29, chưa chắc chắn, sẽ kiểm tra). Môi trường thật chỉ dùng HTTPS.

## 8. Chạy thử toàn bộ sau khi có khung repo (P1-08 đến P1-10)

Khi Claude đã giao khung repo (P1-04 đến P1-07), chép vào thư mục repo rồi chạy:

```powershell
pnpm install
pnpm dev
```

Kỳ vọng:

- Web mở được ở `http://localhost:5173` và hiện “API OK”.
- API chạy ở `http://localhost:8787/api/health` trả về JSON trạng thái.
- `pnpm check` (lint + typecheck + test) báo xanh.

Các lệnh dùng thường xuyên (sẽ có trong `package.json` gốc):

| Lệnh | Tác dụng |
|---|---|
| `pnpm dev` | Chạy web và API cùng lúc |
| `pnpm check` | Lint + kiểm tra kiểu + test |
| `pnpm --filter api db:migrate:local` | Áp migration vào D1 local |
| `pnpm --filter api test` | Chạy test của API |
| `pnpm --filter web build` | Build web |
| `pnpm exec tsx scripts/fake-ea.ts` | Giả lập EA gửi dữ liệu |

## 9. Lỗi thường gặp

| Triệu chứng | Cách xử lý |
|---|---|
| `pnpm` không nhận ra lệnh | Đóng và mở lại terminal; kiểm tra `npm install -g pnpm` đã chạy |
| PowerShell chặn script | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| Cổng 5173 hoặc 8787 đã dùng | Tắt tiến trình đang chiếm hoặc đổi cổng trong cấu hình |
| Lỗi cài gói, đường dẫn quá dài | Đặt repo ở `C:\dev\...`; đã bật `core.longpaths` |
| `wrangler login` không mở được trình duyệt | Sao chép URL trong terminal dán vào trình duyệt |
| MT5 báo không gọi được URL | Chưa thêm URL vào danh sách WebRequest hoặc chưa bật Algo Trading |
| Cảnh báo ký tự xuống dòng (CRLF/LF) | Đã cấu hình `core.autocrlf input` và có `.gitattributes` |

## 10. Checklist hoàn tất

- [ ] Git, Node.js LTS, pnpm, VS Code đã cài; 4 lệnh ở mục 3 chạy đúng
- [ ] Đã cấu hình Git (mục 4)
- [ ] Có tài khoản GitHub và repo private đã clone vào đường dẫn ngắn (mục 5)
- [ ] Có tài khoản Cloudflare đã xác thực email
- [ ] MT5 chạy được, có tài khoản demo, mở được MetaEditor
- [ ] Đã chép các file `.md` vào `docs/`
- [ ] Đã trả lời các câu hỏi chốt ở Plan 3 mục 4 (G0-5)
