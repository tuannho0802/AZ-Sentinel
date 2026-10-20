# AZ Sentinel — Plan 3: Kế hoạch triển khai và Plan Handle Part 1

> Bản nháp v0.1 · 20/10/2026
> Đọc cùng: `AZ_Sentinel_Plan1_EA.md`, `AZ_Sentinel_Plan2_System_DB.md`, `AZ_Sentinel_Rules_BE.md`, `AZ_Sentinel_Rules_FE.md`, `AZ_Sentinel_Local_Setup.md`.

## 0. Cách dùng và ký hiệu tick

Đánh dấu trực tiếp trong file này (hoặc copy vào GitHub Issues/Projects).

| Ký hiệu | Ý nghĩa |
|---|---|
| `[ ]` | Chưa làm |
| `[~]` | Đang làm |
| `[x]` | Xong, đã có bằng chứng |
| `[!]` | Bị chặn (ghi lý do bên cạnh) |

- Mỗi mục có mã (ví dụ `P1-07`) để nhắc lại trong commit và khi trao đổi.
- **Chỉ tick `[x]` khi đã có “Bằng chứng”** ghi ở cuối mục (output lệnh, ảnh chụp, số đo). Không tick theo cảm giác.
- Người làm: **[Bạn]** chạy trên máy của bạn hoặc thao tác trên Cloudflare/MT5; **[Claude]** viết mã và tài liệu trong cuộc trò chuyện.

## 1. Cấu trúc repo và ánh xạ deploy

Một repo duy nhất (monorepo, pnpm workspaces). Mỗi phần deploy được tách bằng **Root directory** trên Cloudflare Workers Builds: mỗi Worker kết nối vào cùng repo, đặt Root directory trỏ tới thư mục chứa `wrangler.jsonc` của nó, và có thể đặt watch path riêng để chỉ build khi file liên quan đổi.

```
az-sentinel/
├─ apps/
│  ├─ api/                 # Worker: Hono + D1 + cron        → deploy #1
│  │  ├─ src/              # index.ts, routes/, middleware/, services/, db/, cron/
│  │  ├─ migrations/       # SQL có phiên bản
│  │  ├─ test/
│  │  ├─ wrangler.jsonc
│  │  ├─ drizzle.config.ts
│  │  ├─ .dev.vars.example
│  │  └─ package.json
│  └─ web/                 # SPA React/Vite, phục vụ bằng static assets → deploy #2
│     ├─ src/              # pages/, features/, components/, lib/
│     ├─ index.html
│     ├─ vite.config.ts
│     ├─ wrangler.jsonc    # chỉ có assets, không có mã Worker
│     └─ package.json
├─ packages/
│  └─ shared/              # zod schema, kiểu, hằng số dùng chung (nhập trực tiếp mã TS, không build riêng)
├─ ea/                     # MQL5 — không deploy, phát hành .ex5 thủ công
├─ scripts/                # fake-ea.ts, seed-root-admin.ts, ...
├─ docs/                   # các Plan, Rules, spike-results.md
├─ package.json
├─ pnpm-workspace.yaml
├─ biome.json
├─ tsconfig.base.json
├─ .node-version
├─ .gitattributes
└─ .gitignore
```

| Thành phần | Root directory | Build command | Deploy command | Watch paths |
|---|---|---|---|---|
| API | `apps/api` | (không cần) | `npx wrangler deploy` | `apps/api/**`, `packages/shared/**` |
| Web | `apps/web` | `pnpm build` | `npx wrangler deploy` | `apps/web/**`, `packages/shared/**` |
| EA | không deploy | — | — | — |

Ghi chú:

- Watch path **phải gồm `packages/shared/**`** vì cả hai ứng dụng nhập từ đó.
- Cần kiểm tra ở Part 4: bước cài dependency của Workers Builds với pnpm workspace khi Root directory là thư mục con. Nếu có vấn đề, đặt build command để chạy `pnpm install` ở gốc repo trước.
- **Cùng origin để tránh CORS và lỗi cookie:** hai Worker gắn vào cùng một domain tùy chỉnh bằng route:
  - Web: `example.com/*`
  - API: `example.com/api/*` (route cụ thể hơn thắng).
  Domain `workers.dev` không dùng được cho cookie phiên giữa hai Worker khác subdomain (các subdomain `workers.dev` được trình duyệt coi là các site khác nhau). Vì vậy **cần một domain riêng trước Part 4**; Part 1-3 chỉ cần `workers.dev` cho API.
- Môi trường local: web chạy ở cổng 5173, API ở 8787; Vite proxy `/api` sang 8787 nên cũng là cùng origin.

## 2. Quy trình làm việc

- Nhánh: `main` (luôn chạy được), mỗi Part một nhánh `part-N-ten-ngan`; hợp nhất khi toàn bộ mục của Part đã `[x]`, rồi gắn tag `part-N-done`.
- Commit nhỏ, thông điệp bắt đầu bằng mã mục: `P1-14: ingest ghi bằng một batch`.
- Trước khi hợp nhất: `pnpm check` (lint + typecheck + test) phải xanh.
- Mỗi Part kết thúc bằng một mục “Tổng kết” ghi số liệu và quyết định vào `docs/`.
- Không sang Part tiếp theo khi còn mục `[!]` của Part hiện tại, trừ khi có ghi quyết định bỏ qua.

## 3. Tổng quan các Part

| Part | Nội dung | Tương ứng Plan 2 | Xong khi |
|---|---|---|---|
| 1 | Khởi tạo monorepo + spike đo hạn mức + thử MT5 | Phase 0 | Có số đo thật và quyết định GO/NO-GO |
| 2 | Schema đầy đủ, xác thực, RBAC, rootAdmin, đăng ký và duyệt | Phase 1a | Đăng ký → duyệt → đăng nhập chạy; test phân quyền xanh |
| 3 | Ingest hoàn chỉnh, quản lý liên kết EA, EA v0.1-v0.2 | Phase 1b | EA demo gửi được; dữ liệu khớp MT5 |
| 4 | Web MVP + deploy staging/prod bằng Root directory + domain | Phase 1c | Tổng quan + chi tiết chạy trên domain; 3 EA demo 48 giờ |
| 5 | Biến động, rủi ro, biểu đồ, màn hình VPS, offline, Telegram, dọn dữ liệu | Phase 2 | Theo danh sách Part 5 |
| 6 | SSE, nhật ký quản trị, xoay khóa, sao lưu, kiểm thử tải, rà soát bảo mật | Phase 3 | Theo danh sách Part 6 |

## 4. Gate 0: điều kiện để bắt đầu Part 1

Tick khi đã xong và đã gửi cho Claude các câu trả lời.

- [ ] G0-1 Môi trường local đã cài đủ theo `AZ_Sentinel_Local_Setup.md` (mục 2) và các lệnh kiểm tra trong mục 3 chạy đúng.
- [ ] G0-2 Đã có tài khoản Cloudflare (gói free).
- [ ] G0-3 Đã có repo GitHub trống (private) và clone về máy.
- [ ] G0-4 Đã có MT5 và tài khoản demo.
- [ ] G0-5 Đã trả lời các câu hỏi chốt:
  1. Hệ điều hành máy phát triển (Windows 11, macOS, Linux)?
  2. Có quen TypeScript không? (ảnh hưởng mức chú thích mã)
  3. Xác thực: email + mật khẩu, thêm OAuth, hay chỉ OAuth?
  4. Đã có domain chưa? (cần trước Part 4)
  5. Admin có được xem TKGD của User khác không?
  6. “Limit tài khoản” có đúng là số TKGD mỗi User được liên kết không?
  7. Cảnh báo: Telegram, email, hay chỉ trên web?

## 5. PART 1 — Plan Handle: khởi tạo monorepo và spike

**Mục tiêu:** có khung repo chạy được ở local; đo được số dòng ghi D1, CPU mỗi request và chi phí băm mật khẩu trên Cloudflare thật; xác nhận MT5 gọi được API. Cuối Part ra quyết định GO/NO-GO cho các điểm rủi ro.

**Phạm vi không làm:** giao diện hoàn chỉnh, đăng ký/duyệt, RBAC, biểu đồ.

### 1.A Chuẩn bị [Bạn]

- [ ] P1-01 Cài Git, Node.js LTS, pnpm, VS Code. Bằng chứng: output `git --version`, `node -v`, `pnpm -v`: ____
- [ ] P1-02 Repo nằm ở đường dẫn ngắn, ngoài OneDrive (ví dụ `C:\dev\az-sentinel`). Bằng chứng: đường dẫn: ____
- [ ] P1-03 MT5 mở được, có tài khoản demo đang kết nối, MetaEditor mở được. Bằng chứng: số tài khoản demo (che bớt): ____

### 1.B Khung repo [Claude viết, Bạn chạy]

- [ ] P1-04 Tệp gốc: `package.json`, `pnpm-workspace.yaml`, `.node-version`, `.gitignore`, `.gitattributes`, `biome.json`, `tsconfig.base.json`, `README.md`.
- [ ] P1-05 `packages/shared`: schema zod của payload ingest v1 (khớp Plan 1 mục 5) và test cơ bản.
- [ ] P1-06 `apps/api`: Hono, `GET /api/health`, `wrangler.jsonc` có binding D1, cấu hình Vitest chạy trong runtime Workers.
- [ ] P1-07 `apps/web`: Vite + React + Tailwind, một trang gọi `/api/health` qua proxy và hiện “API OK”.
- [ ] P1-08 [Bạn] `pnpm install` thành công. Bằng chứng: output cuối lệnh: ____
- [ ] P1-09 [Bạn] `pnpm dev` chạy hai ứng dụng; mở `http://localhost:5173` thấy “API OK”. Bằng chứng: ảnh chụp: ____
- [ ] P1-10 [Bạn] `pnpm check` (lint + typecheck + test) xanh; tạo commit đầu tiên và đẩy lên GitHub. Bằng chứng: hash commit: ____

### 1.C D1 ở local [Claude viết, Bạn chạy]

- [ ] P1-11 Migration `0001_spike.sql`: `ea_links`, `link_state` (không chỉ mục phụ), `equity_m5` và `trades` (`WITHOUT ROWID`), `events`.
- [ ] P1-12 [Bạn] Áp migration ở local; kiểm tra bảng bằng `wrangler d1 execute --local`. Bằng chứng: danh sách bảng: ____
- [ ] P1-13 Script seed một liên kết giả (khóa ngẫu nhiên, lưu bản băm SHA-256 và 8 ký tự đầu).

### 1.D Endpoint ingest bản spike [Claude viết, Bạn chạy]

- [ ] P1-14 `POST /api/ea/v1/ingest` theo luồng Plan 2 mục 6: giới hạn body, zod, một truy vấn tra khóa, loại trùng bằng (`sid`, `seq`), đúng một `DB.batch()` để ghi.
- [ ] P1-15 Ở chế độ dev/spike, phản hồi kèm tổng `rows_written` và `rows_read` của batch.
- [ ] P1-16 `scripts/fake-ea.ts`: gửi các tình huống heartbeat, m5_bar, trade_event, gửi trùng `seq`, sai khóa, sai (server, login).
- [ ] P1-17 Test tự động: gửi lại cùng `seq` không thêm dòng; sai khóa 401; liên kết bị khóa 403; (server, login) lệch 409.
- [ ] P1-18 [Bạn] Chạy `fake-ea.ts` ở local và điền số đo:

| Tình huống | Dòng ghi dự kiến | Dòng ghi thực tế |
|---|---|---|
| heartbeat | 1 | ____ |
| m5_bar | 2 | ____ |
| m5_bar + 1 sự kiện đóng lệnh | 3 | ____ |
| gửi trùng `seq` | 0 | ____ |

### 1.E Đo băm mật khẩu [Claude viết, Bạn chạy]

- [ ] P1-19 Endpoint tạm `/api/_spike/hash?iter=N` chỉ tồn tại ở nhánh spike: băm PBKDF2-SHA256 với N vòng lặp (thử 10.000, 50.000, 100.000). Ghi rõ **phải xóa** trước Part 2 (xem P1-31).

### 1.F Deploy spike lên `workers.dev` [Bạn thao tác, Claude hướng dẫn]

- [ ] P1-20 `wrangler login` thành công; tạo D1 remote (`az-sentinel-spike`); điền `database_id` vào `wrangler.jsonc`. Bằng chứng: output `wrangler whoami`: ____
- [ ] P1-21 Áp migration lên D1 remote; deploy API. Bằng chứng: URL `https://…workers.dev`: ____
- [ ] P1-22 Chạy `fake-ea.ts` vào URL `workers.dev` (khoảng 100 request, rải rác). Đọc Workers Metrics/Logs để lấy CPU time:

| Chỉ số | Kết quả |
|---|---|
| CPU time p50 của ingest | ____ ms |
| CPU time p99 của ingest | ____ ms |
| Lỗi 1102 (vượt CPU) | ____ |

- [ ] P1-23 Gọi `/api/_spike/hash` trên remote với 10.000, 50.000, 100.000 vòng, mỗi mức 10 lần:

| Số vòng | Thành công/10 | Lỗi 1102 | CPU ghi nhận |
|---|---|---|---|
| 10.000 | ____ | ____ | ____ |
| 50.000 | ____ | ____ | ____ |
| 100.000 | ____ | ____ | ____ |

- [ ] P1-24 Deploy `apps/web` (chỉ assets) lên `workers.dev`; tải trang và các tệp tĩnh khoảng 20 lần; so với số request của Worker web trong dashboard để xác nhận request static assets không bị tính. Bằng chứng: số liệu: ____
- [ ] P1-25 Đối chiếu số dòng ghi/đọc ở dashboard D1 với số request đã gửi (kiểm tra dự báo trong Plan 2 mục 9). Bằng chứng: ____

### 1.G Thử MT5 [Claude viết, Bạn chạy]

- [ ] P1-26 `ea/AZ_Spike.mq5` tối thiểu: `OnTimer` mỗi 10 giây gửi JSON tài khoản (có hàm escape JSON), in mã trả về.
- [ ] P1-27 [Bạn] Thêm URL `workers.dev` vào Tools → Options → Expert Advisors → Allow WebRequest; chạy trên demo; thấy mã 200 và dòng `link_state` được cập nhật ở D1 remote. Bằng chứng: log Experts + truy vấn D1: ____
- [ ] P1-28 [Bạn] Cố ý bỏ URL khỏi danh sách cho phép và ghi lại mã lỗi `GetLastError()` thực tế (để xác nhận “4014” trong Plan 1 mục 6). Mã thật: ____
- [ ] P1-29 (Tùy chọn) Thử gọi `http://127.0.0.1:8787` từ MT5 ở local để kiểm thử không cần deploy. Kết quả: ____

### 1.H Kết luận [Cả hai]

- [ ] P1-30 Điền `docs/spike-results.md` với toàn bộ bảng số đo ở trên.
- [ ] P1-31 Xóa mã spike không giữ lại (endpoint `/api/_spike/*`, D1 spike, dữ liệu giả); giữ lại `fake-ea.ts` và migration nếu dùng tiếp.
- [ ] P1-32 Chốt các quyết định ở mục 6 và ghi vào `docs/spike-results.md`.
- [ ] P1-33 Hợp nhất nhánh `part-1-spike` vào `main`, gắn tag `part-1-done`.

## 6. Quyết định cuối Part 1

| Câu hỏi | Ngưỡng đạt | Nếu đạt | Nếu không đạt |
|---|---|---|---|
| Số dòng ghi mỗi ingest | heartbeat ≤ 1, m5_bar ≤ 2 | Giữ schema | Tìm chỉ mục hoặc bảng gây ghi thừa, sửa schema |
| CPU ingest trên Cloudflare | p99 dưới 8 ms (hạn mức free là 10 ms) | Ở lại gói free | Tối ưu mã; nếu vẫn vượt thì Workers Paid |
| Băm mật khẩu | Không lỗi 1102 ở số vòng chấp nhận được (và runtime chấp nhận số vòng đó) | Tự quản mật khẩu | Chuyển OAuth hoặc nâng Workers Paid |
| Static assets | Không tính vào request của Worker web | Giữ ngân sách ở Plan 2 mục 9 | Tính lại ngân sách, thêm dòng dashboard |
| MT5 gọi API | Mã 200 từ demo | Tiếp tục | Điều tra tường lửa/URL/chứng chỉ |
| Dự báo vs thực tế (P1-25) | Lệch dưới 30% | Giữ dự báo | Cập nhật Plan 2 mục 9 |

Quyết định ghi lại: ____

## 7. Checklist mức milestone của các Part sau

Khi bắt đầu mỗi Part, Claude sẽ tách thành Plan Handle chi tiết như Part 1.

### Part 2 — Schema, xác thực, RBAC
- [ ] Schema đầy đủ (Plan 2 mục 4) và trigger bảo vệ rootAdmin gốc
- [ ] Script tạo rootAdmin gốc
- [ ] Đăng ký → pending → duyệt/từ chối → đăng nhập
- [ ] Session cookie, kiểm tra Origin, giới hạn tần suất đăng nhập/đăng ký
- [ ] Bộ test phân quyền (User A không đọc được dữ liệu User B; Admin không đụng được Admin/rootAdmin)
- [ ] Nhật ký `audit_log` cho mọi thao tác quản trị

### Part 3 — Ingest và EA
- [ ] CRUD liên kết EA, hiện khóa một lần, xoay khóa, kiểm tra giới hạn số TKGD
- [ ] Ingest hoàn chỉnh (trade events, positions, equity_m5)
- [ ] EA v0.1 (heartbeat + m5_bar) và v0.2 (trade_event + hàng đợi + retry + file lưu bền)
- [ ] Bộ kiểm thử EA ở Plan 1 mục 9

### Part 4 — Web MVP và deploy
- [ ] Trang Đăng nhập/Đăng ký/Chờ duyệt, Tổng quan, Chi tiết TKGD, Liên kết của tôi, Quản trị cơ bản
- [ ] Domain tùy chỉnh gắn vào Cloudflare
- [ ] Deploy staging và prod: hai Worker, Root directory `apps/api` và `apps/web`, route cùng origin
- [ ] Xác nhận Workers Builds cài dependency đúng với pnpm workspace
- [ ] 3 EA demo chạy 48 giờ, số liệu khớp MT5

### Part 5 — Tính năng Phase 2
- [ ] Trigger biến động và rủi ro trên EA (v0.3)
- [ ] Biểu đồ equity, lịch sử lệnh, màn hình theo VPS
- [ ] Cron phát hiện offline/online, cảnh báo Telegram
- [ ] Job gộp `equity_h1` và dọn dữ liệu

### Part 6 — Phase 3
- [ ] SSE hoặc WebSocket (sau khi kiểm tra hạn mức)
- [ ] Giao diện nhật ký quản trị
- [ ] Sao lưu D1 tự động và thử khôi phục
- [ ] Kiểm thử tải với 30 EA giả lập
- [ ] Rà soát bảo mật theo danh sách ở Plan 2 mục 10
- [ ] EA v1.0, đóng gói `.ex5`, tài liệu cài đặt

## 8. Nhật ký tiến độ

| Ngày | Part/Mục | Việc đã làm | Vướng mắc / quyết định |
|---|---|---|---|
| | | | |
