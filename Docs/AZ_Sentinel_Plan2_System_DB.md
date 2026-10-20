# AZ Sentinel — Plan 2: Hệ thống web, DB và codebase

> Bản nháp v0.2 · 20/10/2026 · Stack đã chốt: **Cloudflare Workers + D1**.
> Phần EA (MQL5) nằm ở file `AZ_Sentinel_Plan1_EA.md`.
> Thay đổi so với v0.1: xem mục 14.

## 0. Tóm tắt, thuật ngữ và giả định

- **Mục tiêu:** hệ thống web theo dõi khoảng 30 tài khoản MT5 (mỗi tài khoản một EA): online/offline, balance, equity, floating P/L, lệnh đang mở, lịch sử lệnh, và biết nhanh VPS nào đang treo EA nào.
- **User:** tài khoản đăng nhập web. **TKGD:** tài khoản giao dịch MT5 mà EA đang chạy. **Liên kết EA:** một TKGD gắn với một API key.
- **Giả định cần xác nhận:** “limit tài khoản” dành cho User nghĩa là số TKGD tối đa mà User đó được liên kết. Admin và rootAdmin không bị giới hạn số TKGD/EA của chính mình.
- **Nguyên tắc xuyên suốt:** EA chỉ đọc và báo cáo; mọi request idempotent; mỗi lần ingest chỉ ghi số dòng tối thiểu; việc nặng làm bằng một câu SQL.

## 1. Vai trò và phân quyền

| Hành động | rootAdmin | Admin | User |
|---|---|---|---|
| Xem và quản lý TKGD của mình | Có | Có | Có |
| Số TKGD/EA của mình | Không giới hạn | Không giới hạn | Theo giới hạn được đặt |
| Xem TKGD của người khác | Có | Có (đề xuất) | Không |
| Duyệt hoặc từ chối đăng ký | Có | Có | Không |
| Đặt giới hạn số TKGD cho User | Có | Có | Không |
| Khóa hoặc xóa User | Có | Có (chỉ User) | Không |
| Nâng hoặc hạ vai trò Admin | Có | Không | Không |
| Tạo thêm rootAdmin | Có | Không | Không |
| Xóa, hạ vai trò hoặc khóa rootAdmin gốc | Không ai được | Không | Không |

Quy tắc:

- **rootAdmin gốc:** tạo bằng script khởi tạo một lần (không qua đăng ký), đánh dấu `is_protected = 1`. API chặn xóa, hạ vai trò, khóa; thêm trigger ở D1 để chặn cả khi ai đó gọi thẳng vào DB.
- **Đăng ký mới:** trạng thái `pending`, chưa đăng nhập được. Admin hoặc rootAdmin (không phải chính người đăng ký) duyệt; khi duyệt đặt giới hạn số TKGD (mặc định lấy từ settings).
- **Giới hạn:** chỉ áp cho vai trò User, kiểm tra khi tạo liên kết EA mới. Admin và rootAdmin không giới hạn.
- **Phạm vi Admin:** Admin chỉ quản lý User; chỉ rootAdmin được nâng hoặc hạ Admin.
- Mọi thao tác quản trị ghi vào `audit_log`.

## 2. Kiến trúc

```
EA (MT5) --HTTPS POST--> Worker (API) --> D1
Trình duyệt --> Worker: static assets (SPA) + /api/*
Cron Trigger (2 phút/lần) --> sự kiện online/offline
Cron Trigger (hằng ngày)  --> gộp equity, dọn dữ liệu
Sau này: Telegram bot cho cảnh báo
```

Một Worker duy nhất phục vụ cả SPA và API trên cùng một origin (không cần CORS). Cron trên gói free chỉ có 10 ms CPU mỗi lần, nên việc nặng làm bằng một câu SQL trong D1 thay vì lặp trong mã.

## 3. Codebase (đã chọn)

### 3.1 Quyết định

**Một repo, một package, một Worker.** Không dùng monorepo: dự án một người làm, một đích triển khai, chỉ có một mã dùng chung (schema zod giữa EA-API và web). Monorepo (pnpm workspaces + Turborepo) thêm chi phí cấu hình mà chưa có lợi ích. Khi nào tách: nếu sau này có ứng dụng mobile hoặc nhiều Worker.

| Lớp | Lựa chọn | Lý do |
|---|---|---|
| Ngôn ngữ | TypeScript (strict) | Chung kiểu dữ liệu cho API và web |
| Khởi tạo | Template chính thức `vite-react-template` của Cloudflare | Đã nối sẵn Hono + Vite + React |
| Build/dev | Vite + `@cloudflare/vite-plugin` | Chạy Worker và web cùng một dev server, môi trường local giống production |
| Backend | Hono | Nhẹ, chạy tốt trên Workers, middleware sẵn |
| Kiểm tra dữ liệu | zod + `@hono/zod-validator` | Một schema cho cả validate và kiểu |
| DB truy cập | Drizzle ORM (D1) cho CRUD; `prepare().batch()` thuần cho đường ingest và cron | Kiểu an toàn cho phần quản trị; kiểm soát từng câu SQL ở đường nóng |
| Migration | `drizzle-kit generate` tạo file SQL, áp bằng `wrangler d1 migrations apply` | Một thư mục `migrations/` có phiên bản, áp được cho dev/staging/prod |
| Frontend | React + TanStack Query + Wouter (hoặc React Router) | Poll 30 giây, cache, refetch khi tab hiển thị |
| UI | Tailwind CSS + shadcn/ui | Bảng, form, dialog có sẵn |
| Biểu đồ | Lightweight Charts (equity) hoặc Recharts | Chọn một ở Phase 2 |
| Xác thực | Tự viết (session cookie + bảng `sessions`) | Luồng duyệt User và RBAC là riêng; thư viện auth đầy đủ khó khớp và có thể nặng CPU |
| Test | Vitest + `@cloudflare/vitest-pool-workers` | Chạy test trong runtime Workers với D1 thật (local) |
| Lint/format | Biome | Một công cụ, cấu hình ít |
| Package manager | pnpm | Nhanh, lockfile chặt |

Khi khởi tạo, dùng phiên bản ổn định mới nhất của từng gói và ghim bằng lockfile; không ghi số phiên bản vào kế hoạch.

### 3.2 Cấu trúc thư mục

```
az-sentinel/
├─ ea/                         # MQL5, không thuộc npm
│  └─ MQL5/
│     ├─ Experts/AZ_Sentinel_Reporter.mq5
│     └─ Include/AZ_Reporter.mqh
├─ src/
│  ├─ shared/                  # dùng chung worker + web
│  │  ├─ ingest-schema.ts      # zod: payload EA (nguồn sự thật duy nhất)
│  │  ├─ types.ts              # vai trò, trạng thái, DTO
│  │  └─ constants.ts
│  ├─ worker/
│  │  ├─ index.ts              # Hono app + export { fetch, scheduled }
│  │  ├─ routes/
│  │  │  ├─ ingest.ts          # POST /api/ea/v1/ingest
│  │  │  ├─ auth.ts            # register, login, logout, me
│  │  │  ├─ links.ts           # CRUD liên kết EA, rotate-key
│  │  │  ├─ view.ts            # overview, vps, links/:id, equity, trades, events
│  │  │  └─ admin.ts           # users, approve, audit
│  │  ├─ middleware/           # session, rbac, origin-check, rate-limit, body-limit
│  │  ├─ services/             # password, apikey, ingest-writer, link-limit
│  │  ├─ db/
│  │  │  ├─ schema.ts          # Drizzle schema
│  │  │  └─ sql.ts             # câu SQL thô cho ingest và cron
│  │  └─ cron/
│  │     ├─ presence.ts        # phát hiện online/offline
│  │     └─ maintenance.ts     # gộp equity_h1, dọn dữ liệu
│  └─ web/
│     ├─ main.tsx
│     ├─ pages/                # Login, Register, Pending, Overview, Vps, LinkDetail, MyLinks, Admin
│     ├─ components/
│     └─ lib/                  # api client, format, escape
├─ migrations/                 # SQL có phiên bản
├─ scripts/
│  └─ seed-root-admin.ts       # tạo rootAdmin gốc một lần
├─ tests/
├─ docs/                       # hai file Plan
├─ wrangler.jsonc              # bindings, cron, assets
├─ vite.config.ts
├─ drizzle.config.ts
└─ package.json
```

### 3.3 Khung cấu hình Worker (minh họa)

```jsonc
{
  "name": "az-sentinel",
  "main": "src/worker/index.ts",
  "compatibility_date": "<ngày khởi tạo>",
  "assets": {
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  },
  "d1_databases": [
    { "binding": "DB", "database_name": "az-sentinel-db", "database_id": "<id>",
      "migrations_dir": "migrations" }
  ],
  "triggers": { "crons": ["*/2 * * * *", "15 3 * * *"] },
  "observability": { "enabled": true }
}
```

`run_worker_first: ["/api/*"]` để chỉ request API đi qua Worker; trang tĩnh do assets phục vụ.

### 3.4 Quy ước mã

- Schema payload EA định nghĩa một lần trong `shared/ingest-schema.ts`; Worker dùng để validate, tài liệu hóa API dựa trên đó.
- **Đường ingest** (`routes/ingest.ts` + `services/ingest-writer.ts`) dùng SQL thô và đúng **một** `DB.batch([...])` cho mọi lần ghi. Không dùng ORM ở đây.
- Mọi truy vấn dữ liệu của User đi qua một hàm lọc theo chủ sở hữu hoặc vai trò, không viết `WHERE owner_id` rải rác.
- Không `console.log` dữ liệu nhạy cảm (API key, cookie).
- Bí mật dùng `wrangler secret`; file `.dev.vars` cho local, đã đưa vào `.gitignore`.
- Ba môi trường (dev, staging, prod) với D1 riêng, khai báo bằng `env` trong `wrangler.jsonc`.

### 3.5 Lệnh khởi tạo (tham khảo)

```
npm create cloudflare@latest -- --template=cloudflare/templates/vite-react-template
npx wrangler d1 create az-sentinel-db
pnpm add drizzle-orm zod @hono/zod-validator
pnpm add -D drizzle-kit vitest @cloudflare/vitest-pool-workers @biomejs/biome
```

## 4. Mô hình dữ liệu (D1)

Nguyên tắc: **bảng nóng nhỏ, bảng lạnh gọn**. Mỗi lần gửi chỉ cập nhật một dòng trạng thái; lịch sử chỉ thêm theo nhịp M5 hoặc theo sự kiện. Theo tài liệu D1, mỗi chỉ mục thêm một dòng ghi khi lần ghi đụng cột được đánh chỉ mục, nên không đặt chỉ mục trên cột bị cập nhật liên tục.

- **users:** id, email (duy nhất), password_hash, display_name, role (`root_admin`, `admin`, `user`), status (`pending`, `active`, `rejected`, `suspended`), max_links (null = không giới hạn), is_protected, created_at, approved_by, approved_at, last_login_at.
- **sessions:** id (băm), user_id, expires_at, ip, user_agent. Chỉ ghi khi đăng nhập và đăng xuất.
- **ea_links** (dòng lạnh, chỉ ghi khi tạo hoặc sửa): id, owner_id, login (null cho đến lần ingest đầu), server, broker, name, currency, mode, key_hash (duy nhất), key_prefix, status (`active`, `disabled`), bound_at, created_at. Duy nhất theo (server, login) khi đã gắn.
- **link_state** (dòng nóng, một dòng mỗi liên kết, **không có chỉ mục phụ**): link_id (PK), balance, equity, margin, margin_free, margin_level, floating_pl, positions_json, pending_json, last_reason, **last_seen_at, last_seq, last_sid, ea_ver, last_ip, vps_label, presence** (0 online, 1 offline). Danh sách lệnh đang mở lưu thành một JSON trong dòng này, nên mỗi lần gửi chỉ ghi một dòng dù có bao nhiêu lệnh.
- **equity_m5** (`WITHOUT ROWID`): link_id, ts, balance, equity, floating_pl, margin_level; khóa chính (link_id, ts). Giữ 14 ngày, sau đó gộp theo giờ vào `equity_h1` (giữ 1 năm).
- **trades** (`WITHOUT ROWID`): link_id, ticket (position id), symbol, type, volume, open_time, open_price, close_time, close_price, sl, tp, profit, swap, commission, comment, magic; khóa chính (link_id, ticket). Upsert khi mở và khi đóng theo sự kiện, nên an toàn khi gửi lại.
- **events:** id, link_id, ts, type (`offline`, `online`, `risk`, `volatility`, `auth_fail`, ...), detail_json. Chỉ mục (link_id, ts).
- **audit_log:** id, ts, actor_id, action, target, detail_json.
- **settings:** key, value (`default_user_limit`, `offline_threshold_sec`, `retention_days`, ...).

Lý do hai thay đổi so với v0.1:

- `last_seen_at`, `last_seq`, `ea_ver`, `last_ip`, `vps_label` chuyển từ `ea_links` sang `link_state`. Nếu để ở `ea_links`, mỗi request ghi hai dòng (cả hai bảng); gộp vào dòng nóng chỉ còn một.
- `WITHOUT ROWID` cho bảng có khóa chính ghép: bảng thường (rowid) tạo thêm một chỉ mục ẩn cho khóa chính, mỗi lần chèn tốn hai dòng ghi; `WITHOUT ROWID` chỉ tốn một.

Phác thảo SQL (minh họa):

```sql
CREATE TABLE link_state (
  link_id INTEGER PRIMARY KEY REFERENCES ea_links(id),
  balance REAL, equity REAL, margin REAL, margin_free REAL,
  margin_level REAL, floating_pl REAL,
  positions_json TEXT, pending_json TEXT, last_reason TEXT,
  last_seen_at INTEGER NOT NULL, last_seq INTEGER, last_sid TEXT,
  ea_ver TEXT, last_ip TEXT, vps_label TEXT,
  presence INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE equity_m5 (
  link_id INTEGER NOT NULL, ts INTEGER NOT NULL,
  balance REAL, equity REAL, floating_pl REAL, margin_level REAL,
  PRIMARY KEY (link_id, ts)
) WITHOUT ROWID;

CREATE TABLE trades (
  link_id INTEGER NOT NULL, ticket INTEGER NOT NULL,
  symbol TEXT, type TEXT, volume REAL,
  open_time INTEGER, open_price REAL, close_time INTEGER, close_price REAL,
  sl REAL, tp REAL, profit REAL, swap REAL, commission REAL,
  comment TEXT, magic INTEGER,
  PRIMARY KEY (link_id, ticket)
) WITHOUT ROWID;

-- Chặn xóa/hạ/khóa rootAdmin gốc ngay cả khi gọi thẳng vào DB
CREATE TRIGGER protect_root_delete BEFORE DELETE ON users
WHEN OLD.is_protected = 1
BEGIN SELECT RAISE(ABORT, 'protected user'); END;

CREATE TRIGGER protect_root_update BEFORE UPDATE ON users
WHEN OLD.is_protected = 1 AND (NEW.role <> OLD.role OR NEW.status <> OLD.status)
BEGIN SELECT RAISE(ABORT, 'protected user'); END;
```

## 5. API

| Nhóm | Endpoint | Ghi chú |
|---|---|---|
| EA | `POST /api/ea/v1/ingest` | Header `X-API-Key`; idempotent theo (`sid`, `seq`) và deal ticket; lần đầu gắn khóa với (server, login) |
| Xác thực | `POST /api/auth/register`, `/login`, `/logout`; `GET /api/me` | Đăng ký tạo User ở trạng thái `pending` |
| Liên kết EA | `GET, POST /api/links`; `PATCH, DELETE /api/links/:id`; `POST /api/links/:id/rotate-key` | Kiểm tra giới hạn khi tạo; khóa chỉ hiện một lần |
| Xem dữ liệu | `GET /api/overview`, `/api/vps`, `/api/links/:id`, `/equity`, `/trades`, `/events` | Lọc theo chủ sở hữu hoặc vai trò |
| Quản trị | `GET /api/admin/users`; `POST /api/admin/users/:id/approve`, `/reject`, `/suspend`; `PATCH, DELETE /api/admin/users/:id`; `GET /api/admin/audit` | Chặn mọi thao tác lên rootAdmin gốc |
| Sức khỏe | `GET /api/health` | Không cần đăng nhập, không lộ thông tin |

Quy ước: JSON, mã lỗi thống nhất, mọi truy vấn kiểm tra quyền sở hữu để tránh truy cập chéo.

## 6. Luồng ingest

1. Giới hạn kích thước body (64 KB) trước khi đọc; từ chối nếu vượt.
2. Validate bằng zod; ép kiểu số; cắt độ dài chuỗi; giới hạn số lệnh.
3. Băm `X-API-Key` bằng SHA-256 (WebCrypto) rồi **một** truy vấn: `ea_links JOIN users LEFT JOIN link_state` theo `key_hash`. Trả 401 nếu không thấy.
4. Kiểm tra trạng thái: liên kết `disabled` hoặc User chưa `active` → 403.
5. Lần đầu (login còn null): gắn khóa với (server, login); vi phạm ràng buộc duy nhất → 409 và ghi sự kiện `auth_fail`. Về sau, (server, login) lệch → 409.
6. Loại trùng: nếu `sid` giống phiên trước và `seq` ≤ `last_seq` → trả 200 ngay với `ack_seq` cũ, không ghi gì.
7. Một `DB.batch([...])`:
   - upsert `link_state` (kèm `presence = 0`);
   - nếu `reason` có `m5_bar` → `INSERT OR IGNORE` vào `equity_m5`;
   - mỗi sự kiện giao dịch → upsert `trades` (`ON CONFLICT ... DO UPDATE`, dùng `COALESCE` để không ghi đè dữ liệu đóng lệnh bằng null);
   - nếu `presence` trước đó là 1 → chèn sự kiện `online`.
8. Trả `{ ack_seq, next_interval_sec?, commands: [] }`. EA chỉ xóa sự kiện khỏi hàng đợi sau khi nhận ack, nên lỗi ở bước 7 (trả 503) không làm mất dữ liệu.
9. Server dùng **giờ nhận request** cho `last_seen_at`, không dùng `ts_utc` của EA.

## 7. Màn hình

- Đăng nhập, đăng ký, màn hình “chờ duyệt”.
- **Tổng quan:** tổng balance, equity, floating P/L; số TKGD online và offline; danh sách TKGD (trạng thái, nhãn VPS, last seen, equity, float, drawdown).
- **Theo VPS:** nhóm theo nhãn VPS, thấy ngay VPS nào đang treo những tài khoản nào và VPS nào có tài khoản offline; tìm nhanh theo nhãn.
- **Chi tiết TKGD:** biểu đồ equity, lệnh đang mở, lịch sử lệnh, sự kiện, thông tin EA (phiên bản, IP gần nhất).
- **Liên kết EA của tôi:** tạo liên kết, hiện khóa một lần, hướng dẫn cài đặt, xoay khóa.
- **Quản trị:** danh sách chờ duyệt, danh sách User (vai trò, giới hạn), nhật ký thao tác.

## 8. Online/offline, thời gian thực và dữ liệu lịch sử

- **Online** được tính khi đọc: `now - last_seen_at < offline_threshold` (mặc định 8 phút; EA gửi ít nhất mỗi 5 phút kèm tối đa 20 giây trễ ngẫu nhiên), không cần ghi thêm.
- **Cron 2 phút** chỉ để phát hiện chuyển trạng thái: một câu SQL chọn các liên kết quá ngưỡng và `presence = 0`, đặt `presence = 1` và chèn sự kiện `offline` trong cùng một batch. Chuyển ngược lại (online) do ingest xử lý (mục 6).
- **Thời gian thực:** bản đầu dashboard poll mỗi 30 giây khi tab đang hiển thị (TanStack Query tự dừng khi tab ẩn). Bản sau dùng SSE hoặc WebSocket (Durable Objects, cần kiểm tra hạn mức trước).
- **Lịch sử:** job hằng ngày gộp `equity_m5` quá 14 ngày thành `equity_h1` bằng SQL rồi xóa dữ liệu quá hạn theo lô (tối đa vài nghìn dòng mỗi lần, vì D1 giới hạn câu lệnh sửa quá nhiều dòng); bảng `trades` giữ lâu dài.
- **Nhãn VPS:** gõ tự do nên cần chuẩn hóa (viết hoa, cắt khoảng trắng); sai chính tả sẽ tách thành nhóm khác. Giai đoạn sau thêm bảng `vps` (tên, ghi chú, chủ sở hữu) và cảnh báo khi cùng nhãn nhưng IP khác.

## 9. Ngân sách hạn mức (ước tính cho 30 EA)

Hạn mức free kiểm tra ngày 20/10/2026: Workers 100.000 request/ngày, tối đa 1.000 request/phút, 10 ms CPU mỗi request và mỗi cron; D1 5 triệu dòng đọc và 100.000 dòng ghi mỗi ngày, 5 GB lưu trữ, đặt lại lúc 00:00 UTC. Cần kiểm tra lại trước khi triển khai vì Cloudflare có thể đổi.

| Hạng mục | Ước tính mỗi ngày | Hạn mức free |
|---|---|---|
| Request từ EA | 30 × (288 nến M5 + 20-100 sự kiện + trần 20-50 biến động) ≈ 10.500-13.500 | 100.000 request (chung) |
| Request dashboard | 1 người mở cả ngày, poll 30 giây ≈ 2.900; 5 người ≈ 14.400 | |
| Cron | 720 (2 phút) + 1 | |
| **Tổng request** | **≈ 25.000-30.000** | 100.000 |
| Dòng ghi | 30 × (288 `link_state` + 288 `equity_m5` + ~60 trade/event) ≈ 19.000; mỗi dòng 1 lần ghi nhờ không chỉ mục phụ và `WITHOUT ROWID` | 100.000 |
| Dòng đọc | ingest ≈ 13.500 × 2 dòng; dashboard 14.400 lần poll × ~60 dòng ≈ 0,9 triệu; cron ≈ 22.000 | 5 triệu |

Ghi chú:

- Request tới static assets không tính vào hạn mức request của Worker theo tài liệu Cloudflare; xác nhận lại ở Phase 0 bằng cách xem số liệu thực tế.
- Số dòng đọc chủ yếu do dashboard. Giữ truy vấn gọn: endpoint tổng quan chỉ đọc `link_state` (30 dòng), không quét `trades` hay `equity_m5` toàn bảng; mọi truy vấn lịch sử dùng khóa chính hoặc chỉ mục.
- Dung lượng: `equity_m5` giữ 14 ngày ≈ 120.000 dòng (vài MB); một năm dữ liệu theo giờ vẫn rất xa mức 5 GB.
- Nếu vượt hạn mức: nâng Workers Paid ($5 mỗi tháng) là giải pháp rẻ nhất; D1 trên gói này còn tính theo dòng đọc/ghi nhưng phần đã bao gồm lớn hơn nhiều so với tải này.
- Phase 0 phải đo: số dòng ghi thực tế (qua `meta.rows_written` của từng truy vấn), CPU mỗi request ingest, CPU của băm mật khẩu.

## 10. Bảo mật

- **Mật khẩu:** băm bằng thuật toán chậm có salt (PBKDF2 qua WebCrypto là lựa chọn gốc của Workers; số vòng lặp tối đa có thể bị giới hạn bởi runtime, cần kiểm tra). Gói free chỉ cho 10 ms CPU mỗi request và băm mật khẩu có thể vượt, nên **đo ở Phase 0**. Nếu vượt: nâng Workers Paid, hoặc đăng nhập OAuth (Google, GitHub) và bỏ mật khẩu.
- **Session:** cookie `HttpOnly`, `Secure`, `SameSite`; kiểm tra Origin cho các thao tác ghi để chống CSRF.
- **Đăng ký:** chống bot (ví dụ Cloudflare Turnstile, cần kiểm tra điều khoản và hạn mức), giới hạn tần suất đăng nhập và đăng ký.
- **API key của EA:** 32 byte ngẫu nhiên, chỉ lưu bản băm SHA-256 cùng 8 ký tự đầu để nhận diện, hiện đầy đủ đúng một lần, xoay được. Lần ingest đầu tiên gắn khóa với (server, login); sai lệch về sau trả 409 và ghi sự kiện.
- **Kiểm tra đầu vào:** giới hạn kích thước body (64 KB), số lệnh và độ dài chuỗi; ép kiểu số; không tin dữ liệu từ EA (kể cả `ts_utc`).
- **Hiển thị:** chống XSS với comment và nhãn VPS (React escape mặc định; không dùng `dangerouslySetInnerHTML`).
- **Phân quyền:** mọi truy vấn lọc theo chủ sở hữu hoặc vai trò, chống truy cập chéo; có test riêng cho trường hợp User A đọc dữ liệu User B.
- **Bí mật:** lưu bằng secret của Wrangler, không để trong mã nguồn.
- **Dữ liệu:** chỉ lưu thông tin cần thiết; không lưu mật khẩu giao dịch hay investor password.
- **Sao lưu:** xuất D1 định kỳ bằng Wrangler và kiểm tra tính năng khôi phục theo thời điểm của gói bạn dùng.

## 11. Vận hành

- Ba môi trường (dev, staging, prod) với D1 riêng; migrations có phiên bản.
- Ghi lỗi và sự kiện quan trọng vào bảng `events`; có endpoint `/api/health`.
- Theo dõi mức dùng hạn mức trên dashboard Cloudflare, đặt ngưỡng cảnh báo khoảng 70%.
- Triển khai bằng Wrangler (hoặc CI từ GitHub). Phát hành EA thủ công (`.ex5`) kèm số phiên bản; server chấp nhận schema phiên bản N và N-1.
- Khi chạm hạn mức, EA tự retry; khi D1 lỗi, API trả 503 để EA giữ hàng đợi.

## 12. Lộ trình

- **Phase 0, spike (1-2 ngày):** khởi tạo từ template; Worker nhận POST từ MT5 demo bằng `WebRequest` và `X-API-Key`; đo CPU ingest, thử băm mật khẩu, đo số dòng ghi D1 qua `rows_written`; xác nhận static assets không tốn hạn mức; chốt hướng xác thực.
- **Phase 1, MVP:** schema, đăng ký và duyệt, RBAC, script tạo rootAdmin; endpoint ingest; EA v0.1-v0.2; trang tổng quan và chi tiết (trạng thái, lệnh đang mở).
- **Phase 2:** trigger biến động và rủi ro; biểu đồ equity; lịch sử lệnh; màn hình theo VPS; phát hiện offline và cảnh báo Telegram; gộp và dọn dữ liệu.
- **Phase 3:** thời gian thực (SSE), giao diện nhật ký quản trị, xoay khóa, tự động sao lưu, kiểm thử tải với 30 EA giả lập, rà soát bảo mật.
- **Tiêu chí hoàn thành MVP:** 3 EA demo chạy liên tục 48 giờ, số liệu khớp với MT5, việc duyệt User và giới hạn TKGD hoạt động đúng.

## 13. Rủi ro và câu hỏi mở

Rủi ro:

- Hạn mức free thay đổi theo thời gian; có phương án dự phòng là Workers Paid ($5 mỗi tháng) hoặc VPS.
- Băm mật khẩu có thể vượt 10 ms CPU ở gói free.
- Số dòng ghi D1 có thể cao hơn dự báo nếu có chỉ mục ngoài ý muốn.
- Số dòng đọc tăng nếu dashboard quét bảng lớn.
- Comment hoặc ký tự lạ làm hỏng JSON nếu EA quên escape.
- Antivirus hoặc tường lửa trên VPS chặn `WebRequest`.
- Hai EA cùng một TKGD gây dữ liệu trùng (đã có khóa chống trùng phía EA và ràng buộc (server, login) phía server).
- Lệch giờ giữa broker, VPS và server.

Câu hỏi mở:

1. “Limit tài khoản” có đúng là số TKGD mỗi User được liên kết không?
2. Admin có được xem TKGD của User khác không?
3. EA chạy MT5, MT4 hay cả hai? (Kế hoạch này viết cho MT5.)
4. Mỗi EA theo dõi một symbol hay nhiều symbol?
5. Bạn quen TypeScript hay ngôn ngữ khác? (Codebase ở mục 3 giả định TypeScript.)
6. Cần cảnh báo qua Telegram, email hay chỉ trên web?
7. Đăng nhập bằng email và mật khẩu, hay thêm OAuth?

## 14. Thay đổi so với v0.1

- Tách thành hai file; thêm mục 3 (codebase) và mục 6 (luồng ingest).
- Chuyển `last_seen_at`, `last_seq`, `ea_ver`, `last_ip`, `vps_label` sang `link_state` để mỗi request chỉ ghi một dòng; thêm `last_sid` và `presence`.
- Dùng `WITHOUT ROWID` cho `equity_m5` và `trades`.
- Dedup bằng (`sid`, `seq`) thay vì chỉ `seq`; server dùng giờ nhận request.
- Thêm ngân sách dòng đọc và kết quả kiểm tra hạn mức hiện tại; ghi rõ các điểm cần đo ở Phase 0.
- Thêm trigger SQL cho rootAdmin gốc và quy tắc dọn dữ liệu theo lô.

## 15. Tên dự án

- **AZ Sentinel** (đề xuất): “lính canh” cho các EA và tài khoản. EA gọi là AZ Sentinel Reporter, web gọi là AZ Sentinel Console. Ngắn, dễ nhớ, đúng bản chất theo dõi.
- Phương án khác: AZ Pulse (nhịp tim, ý heartbeat), AZ Watchtower (tháp canh), AZ Radar, AZ Beacon, AZ Vigil.
- Nên kiểm tra tên miền và trùng tên thương hiệu trước khi dùng chính thức.
