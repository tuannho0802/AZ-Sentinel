# AZ Sentinel

Theo dõi tài khoản MetaTrader 5, lệnh đang mở và giao dịch từ xa, trên một giao diện web (cài được như ứng dụng PWA).

Mỗi terminal MT5 chạy một EA nhỏ gửi dữ liệu về **Gateway** trên cùng VPS. Gateway đẩy lên **Server** (VPS chính) và Server phục vụ giao diện web. Nếu VPS chính sập, **Cloudflare Worker** làm bản dự phòng, nên dữ liệu vẫn vào và người dùng vẫn xem được.

> **Trạng thái:** phần Node/TypeScript đã có test tự động. Bộ cài Windows (Inno Setup, Task Scheduler, PowerShell), Quick Tunnel, Worker thật và EA trên MT5 thật phần lớn **chưa được thử trên môi trường thật**; mỗi tài liệu trong [`Docs/`](Docs/README.md) ghi rõ mục nào đã chạy và mục nào chưa.

## Tính năng

- **Giám sát tài khoản MT5**: Balance, Equity, Margin, Free Margin, Swap, tổng Float P/L; bảng "Lệnh đang mở" theo kiểu tab Trade của MT5.
- **Live theo yêu cầu**: EA chỉ gửi dữ liệu theo tick khi có người đang xem trang chi tiết, nên không tốn tài nguyên lúc không ai dùng.
- **Giao dịch từ xa** (chỉ admin): đóng lệnh, đóng một phần, sửa SL/TP, đóng hàng loạt, đặt lệnh Market/Limit/Stop. Có nhiều lớp an toàn, mặc định tắt ([chi tiết](Docs/AZ_Sentinel_Remote_Trading.md)).
- **Thông báo lỗ float**: chuông thông báo khi lỗ vượt ngưỡng do người dùng đặt ([Plan 5](Docs/AZ_Sentinel_Plan5_Notifications.md)).
- **VPS chính + Cloudflare dự phòng**: tự chuyển sang Worker khi VPS sập, tự quay về khi VPS sống lại, hiển thị đang dùng máy chủ nào.
- **Quick Tunnel tự theo**: không cần tên miền, VPS reset đổi địa chỉ tunnel vẫn vào được ([chi tiết](Docs/AZ_Sentinel_Quick_Tunnel.md)).
- **Whitelist IP và thiết bị**: giới hạn ai được vào VPS ([chi tiết](Docs/AZ_Sentinel_Whitelist_IP.md)).
- **Phân quyền và token**: quản trị viên cấp token Gateway cá nhân và **mã kết nối** cho từng người dùng.
- **PWA**: cài giao diện như một ứng dụng ([chi tiết](Docs/AZ_Sentinel_PWA.md)).
- **Bộ cài Windows**: `AZSentinel-Server-Setup.exe` (Admin) và `AZSentinel-Gateway-Setup.exe` (User), người dùng chỉ cần dán mã kết nối.

## Kiến trúc

```
 MT5 (EA) ──► Gateway (VPS của từng người) ══ WebSocket ══► Server (VPS chính của Admin)
                                                             ├─ BE (Hono) + LiveHub + SQLite
                                                             ├─ giao diện web (FE/dist)
                                                             └─ Quick Tunnel (cloudflared)
                                                                   │  nhịp sống + đồng bộ + địa chỉ tunnel
                                                                   ▼
 Trình duyệt ──► Cloudflare Worker (địa chỉ cố định) ──302──► Quick Tunnel ──► Server
                  │  D1 + Durable Object                (VPS sống: Worker chỉ tốn 1 request mỗi lượt vào)
                  └─ phục vụ giao diện và API dự phòng khi VPS sập
```

- Worker là **"người đi tìm tunnel"**: chuyển hướng lượt mở trang sang tunnel đang sống, và là bản dự phòng đầy đủ khi VPS sập.
- `Server/` chạy nguyên mã `BE/` trên Node (SQLite thay D1), nên truy cập bình thường không tốn request Cloudflare.
- Server chỉ gọi Cloudflare (nhịp sống, đồng bộ) khi có người mở giao diện, để tiết kiệm hạn mức gói free.

Đọc thêm: [Plan 3E](Docs/AZ_Sentinel_Plan3E_VPS_Primary.md), [Quick Tunnel](Docs/AZ_Sentinel_Quick_Tunnel.md), [luồng Admin/User](Docs/AZ_Sentinel_User_Gateway_Flow.md).

## Cấu trúc thư mục

pnpm workspace gồm năm gói: `BE`, `FE`, `Shared`, `Gateway`, `Server`.

| Thư mục | Gói | Vai trò |
|---|---|---|
| `BE/` | `@az-sentinel/api` | API Hono chạy trên Cloudflare Worker (D1, Durable Object `LiveHub`), logic ingest, đăng nhập, whitelist, thông báo, giao dịch từ xa; `edge/` là bộ định tuyến chuyển hướng sang tunnel |
| `FE/` | `@az-sentinel/web` | Giao diện React + Vite, cũng là PWA (`public/sw.js`, `manifest.webmanifest`) |
| `Shared/` | `@az-sentinel/shared` | Schema Zod, kiểu dùng chung, hằng số giao thức giữa FE, BE, Server và Gateway |
| `Server/` | `@az-sentinel/server` | Bản Node của BE cho VPS chính: HTTP, WebSocket, SQLite, phục vụ giao diện (có nén), Quick Tunnel, đồng bộ lên Cloudflare |
| `Gateway/` | `@az-sentinel/gateway` | Chương trình chạy trên VPS có MT5: nhận dữ liệu từ EA, nối lên Server hoặc Worker, đóng gói thành `.exe` |
| `ea/` | | EA MQL5 (`AZ_Spike.mq5`), biên dịch bằng `compile.ps1` |
| `Installer/` | | Script Inno Setup (`az-server.iss`, `az-gateway.iss`) và PowerShell cho bộ cài Windows |
| `Scripts/` | | Chạy môi trường dev (`dev.mjs`, `dev-public.mjs`), `fake-ea.ts`, `seed-link.ts`, `setup-cloudflare.ps1` |
| `Docs/` | | Kế hoạch, quy tắc, hướng dẫn vận hành ([mục lục](Docs/README.md)) |

## Công nghệ

TypeScript, Node.js 22+, pnpm workspace, Hono, Cloudflare Workers + D1 + Durable Objects, SQLite (`node:sqlite`), React 19, Vite, Tailwind CSS 4, TanStack Query, wouter, Vitest, Biome, MQL5.

## Bắt đầu nhanh (máy phát triển)

Yêu cầu: Node.js 22.5 trở lên, pnpm; Windows 11 là môi trường chính ([hướng dẫn cài đủ](Docs/AZ_Sentinel_Local_Setup.md)). Cổng cần trống: 5173 (web), 8080 (Server), 8787 (BE), 47800 (Gateway).

```bash
pnpm install
pnpm dev          # BE + Server + FE + Gateway, chờ từng cổng sẵn sàng, tự mở trình duyệt
```

Một số biến hữu ích: `AZ_DEV_OPEN=0` (không tự mở trình duyệt), `AZ_DEV_NO_GATEWAY=1`, `AZ_DEV_NO_BE=1`.

Thử với VPS thật mà không cài Server ở đó:

```bash
pnpm dev:public   # mở Quick Tunnel, chạy Server + web, in sẵn mã kết nối azc1...
```

Trên VPS chỉ cần chạy `AZSentinel-Gateway-Setup.exe` và dán mã. Chi tiết ở [luồng Admin/User](Docs/AZ_Sentinel_User_Gateway_Flow.md).

Không có MT5 thì giả lập dữ liệu: `pnpm fake-ea`, tạo liên kết thử: `pnpm db:seed:local`.

## Lệnh thường dùng

| Lệnh | Việc |
|---|---|
| `pnpm check` | `biome` + `typecheck` + toàn bộ test (chạy trước khi commit) |
| `pnpm lint:fix` | Tự sửa định dạng và lint |
| `pnpm test` | Test của mọi gói |
| `pnpm db:migrate:local` / `db:migrate:remote` | Áp migration D1 (`BE/migrations/`) |
| `pnpm build:web` | Build giao diện vào `FE/dist` |
| `pnpm pack:server` | Build giao diện rồi đóng gói Server (`Server/release/az-server`) |
| `pnpm build:gateway` | Đóng gói Gateway thành `.exe` |
| `pnpm deploy:api` / `deploy:web` | Deploy Worker lên Cloudflare |

## Triển khai

**Admin** cài `AZSentinel-Server-Setup.exe` trên VPS chính (chọn "Cài nhanh", điền thông tin admin). **User** chỉ cài `AZSentinel-Gateway-Setup.exe` trên VPS có MT5 rồi dán mã kết nối. Muốn người dùng ở máy khác vào được, bật Quick Tunnel (hoặc Cloudflare Tunnel có tên) và, nếu cần bản dự phòng, deploy Worker bằng `Scripts/setup-cloudflare.ps1`. Các bước đầy đủ: [luồng Admin/User](Docs/AZ_Sentinel_User_Gateway_Flow.md), [bộ cài Server](Docs/AZ_Sentinel_Server_Installer.md), [bộ cài Gateway](Docs/AZ_Sentinel_Gateway_Installer.md).

### CI theo tag trong commit

CI chỉ chạy khi **commit cuối** của lần push lên `main` có tag trong message:

| Tag | Việc |
|---|---|
| tag deploy | Kiểm tra, migrate D1, deploy Worker API và Web |
| tag release | Build và phát hành bộ cài Gateway (`gateway-v<version>`) |
| tag release-server | Build và phát hành bộ cài Server (`server-v<version>`) |

Tag viết trong ngoặc vuông, ví dụ `[deploy]`. Chỉ viết đúng khi muốn chạy, vì chuỗi nào khớp cũng kích hoạt workflow (kể cả khi chỉ nhắc tới chúng trong message). Sửa thư mục nào cần tag nào, và nhớ tăng `version` trong `package.json` của `Server/` hoặc `Gateway/` khi phát hành: xem [CI theo tag](Docs/AZ_Sentinel_CI_Tags_And_Gateway_Power.md).

## Cấu hình Server

Server đọc `server.env` (mẫu: [`Server/scripts/server.env.example`](Server/scripts/server.env.example)). Các biến chính:

| Biến | Ý nghĩa |
|---|---|
| `AZ_PORT`, `AZ_HOST` | Cổng và địa chỉ nghe (mặc định `8080`, `127.0.0.1`) |
| `AZ_SRV_NAME`, `AZ_SRV_LOCATION` | Tên và vị trí hiển thị trên giao diện |
| `AZ_SYNC_TOKEN` | Bí mật chung giữa VPS và Worker (trùng `SYNC_TOKEN` của Worker); dùng cho đồng bộ, nhịp sống và trao mã thiết bị |
| `AZ_PUBLIC_URL` | Địa chỉ công khai của VPS, dùng để tạo mã kết nối |
| `AZ_CLOUD_URL`, `AZ_FALLBACK_URL` | Địa chỉ Worker API và Worker giao diện dự phòng |
| `AZ_QUICK_TUNNEL` | `1` = Server tự chạy Quick Tunnel và báo địa chỉ mới cho Worker |
| `AZ_SYNC_ON_DEMAND` | Mặc định chỉ đồng bộ khi có người mở giao diện; `0` = chạy liên tục |
| `AZ_UPDATE_CHECK` | `0` = tắt kiểm tra bản mới trên GitHub Releases |

Token Gateway là của từng người, không đặt trong `server.env`: cấp bằng giao diện web (mục **Token Gateway**) hoặc `node server.mjs token issue|list|reset|revoke` ([chi tiết](Docs/AZ_Sentinel_Gateway_Token.md)).

## Bảo mật

- Mỗi người dùng một token Gateway cá nhân (`azt_...`); mã kết nối mang cả token nên lộ mã là lộ token, dùng **Thu hồi** hoặc **Đặt lại** nếu nghi ngờ.
- Whitelist IP và whitelist thiết bị chặn ở Server VPS; bản dự phòng Cloudflare không áp whitelist.
- Giao dịch từ xa mặc định tắt ở cả EA (`InpAllowRemoteTrading`) và từng liên kết; chỉ admin bật được. **Luôn thử trên tài khoản DEMO trước.**
- Không bật `AZ_DEV_LINKS_API` khi mở ra internet; chỉ dùng để thử.

## PWA

Mở **địa chỉ Worker** (cố định) rồi chọn **Cài ứng dụng**. Không cài từ địa chỉ tunnel vì tunnel đổi mỗi lần chạy lại. Mỗi lần mở app, Worker tìm tunnel đang sống rồi chuyển hướng sang đó. Cách cài, giới hạn và các tối ưu tốc độ mở app: [PWA](Docs/AZ_Sentinel_PWA.md).

## Tài liệu

Toàn bộ nằm ở [`Docs/`](Docs/README.md), gồm kế hoạch theo giai đoạn, quy tắc viết mã ([BE](Docs/AZ_Sentinel_Rules_BE.md), [FE](Docs/AZ_Sentinel_Rules_FE.md)), nhật ký công việc ([BE](Docs/AZ_Sentinel_BE_Workflow.md), [FE](Docs/AZ_Sentinel_FE_Workflow.md)) và hướng dẫn kiểm thử thủ công.

## Quy ước khi đóng góp

- Chạy `pnpm check` trước khi commit; mã được định dạng bằng Biome, xuống dòng kiểu LF.
- Chuỗi hiển thị cho người dùng đặt ở `FE/src/lib/strings.ts`; phân quyền thật nằm ở BE, FE chỉ ẩn/hiện cho tiện.
- Mỗi thay đổi đáng kể ghi một dòng vào nhật ký (`BE_Workflow` hoặc `FE_Workflow`), kèm bằng chứng đã chạy và việc chưa chạy.
