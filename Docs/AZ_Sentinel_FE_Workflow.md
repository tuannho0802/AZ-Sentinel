# AZ Sentinel — FE Workflow (theo dõi tiến độ `FE/`)

> Tệp theo dõi việc đã làm và chưa làm cho `FE/` (`@az-sentinel/web`). Phần BE, Shared, Scripts theo dõi ở `AZ_Sentinel_BE_Workflow.md`.

## QUY TẮC WORKFLOW (đọc trước, không sửa phần này trừ khi chủ dự án yêu cầu)

1. **Chỉ append và sửa nhẹ, không xóa, không viết lại.** Mọi mục ở các phần 2-6 là bằng chứng theo dõi. Không xóa dòng, không đổi thứ tự, không gộp, không viết lại câu chữ của người trước.
2. **Được phép sửa duy nhất các thao tác sau:**
   - Đổi `[ ]` thành `[x]` ở bảng theo dõi (phần 3) và thêm ngày + bằng chứng vào cột tương ứng.
   - Thêm dòng mới vào cuối mỗi bảng/danh sách.
   - Khi một thông tin cũ sai: **không sửa dòng cũ**, thêm dòng mới ở Nhật ký (phần 6) có chữ "Đính chính" và nêu rõ dòng nào.
3. **Mã mục (P1-xx) lấy từ `AZ_Sentinel_Plan3_Implementation.md`.** Việc ngoài Plan thì đặt mã `X-FE-nn` (số tăng dần, không dùng lại) và ghi lý do.
4. **Mỗi lần làm việc xong, thêm một dòng vào Nhật ký (phần 6)** theo mẫu: `Ngày (YYYY-MM-DD) | Ai/Agent nào | Mã mục | Việc đã làm | Bằng chứng | Vướng mắc`.
5. **Chỉ ghi điều đã kiểm chứng.** Dùng nhãn: `ĐÃ CHẠY` (có output/test thực), `CHƯA CHẠY` (chỉ viết code), `NGƯỜI DÙNG XÁC NHẬN` (người dùng báo hoặc gửi ảnh). Không tick `[x]` cho mục chưa có bằng chứng.
6. **Không ghi bí mật vào tài liệu:** API key, token, `database_id` thật. Không đưa bí mật vào biến `VITE_*` (Rules FE mục 7).
7. **Đọc trước khi làm:** Plan 3 (mục đang làm), `AZ_Sentinel_Rules_FE.md`, tệp này (phần 4-5 để biết lệch so với Plan và việc còn nợ).
8. **Không đổi ngữ cảnh đã chốt** (cấu trúc thư mục, thư viện, quyết định ở phần 4) nếu chưa có quyết định mới ghi vào Nhật ký. Thêm thư viện mới phải ghi lý do ở phần 4 (Rules FE mục 2).
9. Văn bản bằng tiếng Việt. Đường dẫn, lệnh, mã dùng định dạng code.
10. Tệp này chỉ cho FE. Việc chéo cả hai ghi ở cả hai tệp, mỗi nơi một dòng.

## 1. Bối cảnh cố định (chỉ append)

- Gói: `FE/` = `@az-sentinel/web`. Ngăn xếp thực tế: React 19, TypeScript strict, Vite 8, TanStack Query 5, Tailwind CSS 4 (qua `@tailwindcss/vite`), Vitest 4 + jsdom + Testing Library.
- Dev: `http://localhost:5173`; proxy `/api` tới BE `http://127.0.0.1:8787` (cấu hình trong `FE/vite.config.ts`).
- Lệnh (từ gốc repo): `pnpm dev` (BE + FE), `pnpm --filter @az-sentinel/web dev|build|test|typecheck`, `pnpm check`.
- Cấu trúc đã có: `FE/src/pages/`, `FE/src/lib/` (`api-client.ts`, `query-client.ts`, `strings.ts`), `main.tsx`, `index.css`.

## 2. Chú giải trạng thái

`[x]` xong và có bằng chứng · `[ ]` chưa làm · `[~]` làm một phần (ghi rõ phần còn thiếu ở cột Ghi chú).

## 3. Bảng theo dõi theo mã mục Plan 3 (Part 1)

| Mã | Việc | Trạng thái | Ngày | Bằng chứng / Ghi chú |
|---|---|---|---|---|
| P1-07 | `FE`: Vite + React + Tailwind, một trang gọi `/api/health` qua proxy và hiện "API OK" | [x] | 2026-10-20 | ĐÃ CHẠY: `vite build` thành công; 2 test FE xanh. |
| P1-09 | `pnpm dev` chạy hai ứng dụng; `http://localhost:5173` thấy "API OK" | [x] | 2026-10-20 | NGƯỜI DÙNG XÁC NHẬN: ảnh chụp trình duyệt trong VS Code hiện "AZ Sentinel" + "API OK"; log BE `GET /api/health 200`. Ảnh cần lưu vào Plan 3 (P1-09). |
| P1-08 | `pnpm install` (phần FE) | [x] | 2026-10-20 | NGƯỜI DÙNG XÁC NHẬN cùng lượt cài chung. |
| P1-10 | `pnpm check` xanh có cả FE | [~] | 2026-10-20 | ĐÃ CHẠY trên Linux: 88 test xanh (19 + 67 + 2). **Còn thiếu:** người dùng xác nhận `pnpm check` xanh sau khi pull FE trên Windows. |
| P1-24 | Deploy `FE` (chỉ assets) lên `workers.dev`; đo static assets không tính request | [~] | 2026-10-20 | Chưa có `FE/wrangler.jsonc`. Chung với BE workflow. Cập nhật 2026-10-20: đã có `FE/wrangler.jsonc` (assets `./dist`, SPA fallback) và `pnpm deploy:web`; ĐÃ CHẠY `--dry-run`. **Chưa deploy thật, chưa đo.** Trên `workers.dev` trang sẽ hiện lỗi API vì khác origin (bình thường ở Part 1). |

### Việc ngoài Plan (mã `X-FE-nn`)

| Mã | Việc | Trạng thái | Ngày | Ghi chú |
|---|---|---|---|---|
| X-FE-01 | Kiểm trạng thái lỗi/"Thử lại" của `HealthPage` trên trình duyệt thật (tắt BE rồi bật lại) | [ ] | | Hướng dẫn đã đưa cho người dùng; test tự động đã phủ trạng thái lỗi. |
| X-FE-02 | Router + khung ứng dụng + trang Tổng quan (thẻ Trạng thái API, Phiên đăng nhập, Liên kết EA rỗng) + trang 404, thay `HealthPage` | [x] | 2026-10-20 | ĐÃ CHẠY: 10 test FE xanh; `vite build` OK. Giúp kiểm UI đủ ba trạng thái (tải/lỗi/rỗng). |
| X-FE-03 | Giao diện đăng nhập (`/login`), `RequireAuth`, đăng xuất, tự về đăng nhập khi API trả 401 | [~] | 2026-10-20 | UI + test xong (9 kịch bản gồm sai mật khẩu 401, chờ duyệt 403, 500). **BE chưa có `/api/auth/login`, `/api/auth/logout`, `/api/me`** (Part 2) nên đăng nhập thật chưa dùng được. |
| X-FE-04 | Giả lập đăng nhập chỉ ở dev server (`FE/dev-mock-auth.ts`, plugin `apply: 'serve'`) | [x] | 2026-10-20 | ĐÃ CHẠY: login 200/401/403/429, `/api/me`, logout qua dev server; `grep` bản build không có tài khoản giả lập. **Không phải đăng nhập thật; phải bỏ khi BE có xác thực.** Tắt bằng `AZ_MOCK_AUTH=0`. |

## 4. Quyết định và lệch so với Plan (chỉ append)

- Tên thư mục thực tế `FE/` (Plan ghi `apps/web`); tên gói `@az-sentinel/web`.
- Tailwind v4 dùng plugin Vite (`@tailwindcss/vite`), không cần `tailwind.config`; `src/index.css` chỉ có `@import "tailwindcss"`.
- Test FE dùng Vitest + jsdom + `@testing-library/react`, đặt cạnh mã: `src/**/*.test.tsx`.
- Mọi gọi API qua `lib/api-client.ts` (`apiGet`), dữ liệu server qua TanStack Query (Rules FE mục 4). Chuỗi giao diện tập trung ở `lib/strings.ts` (Rules FE mục 6).
- Kiểu `HealthResponse`, `ApiErrorBody` lấy từ `@az-sentinel/shared`.

- (2026-10-20) Router: **Wouter 3** (Rules FE mục 2 yêu cầu chốt ở Part 1). Lý do: nhỏ, đủ cho `/login`, `/`, 404; không cần tính năng của React Router.
- (2026-10-20) Hợp đồng xác thực FE giả định, theo Plan 2 mục 5 (BE làm ở Part 2): `POST /api/auth/login` body `{email, password}` (schema `loginRequestSchema` trong `Shared`) trả `MeResponse` `{id, email, display_name, role}`; `POST /api/auth/logout`; `GET /api/me` trả `MeResponse` hoặc 401. Lỗi theo dạng chuẩn `{error:{code,message}}`: 401 sai thông tin, 403 tài khoản chờ duyệt/bị khóa, 429 quá số lần thử; FE hiển thị nguyên `message` của server cho 401/403/429. Hình dạng này **chưa được chốt với BE**, đổi được ở Part 2.
- (2026-10-20) Phiên dùng cookie `HttpOnly` do server cấp; FE không lưu token ở `localStorage` (Rules FE mục 7).
- (2026-10-20) Cấu trúc theo Rules FE mục 3: `features/auth`, `features/overview`, `components`, `pages`. `HealthPage` được thay bằng thẻ `ApiStatusCard` (poll 30 giây theo Rules FE mục 5). Chưa dùng shadcn/ui; component viết bằng Tailwind thuần.
- (2026-10-20) Poll màn hình thử Liên kết EA: có ô chọn 1/2/5/30 giây hoặc Tắt, mặc định 2 giây (`FE/src/features/links/refresh.ts`). Lý do: thử EA gửi mỗi 1 giây thì mức 30 giây của Rules FE mục 5 làm người thử phải bấm Làm mới. Chỉ áp cho màn hình thử chạy local (không tốn hạn mức); dashboard thật vẫn 30 giây cho đến khi có quyết định ở Plan (hoặc SSE ở Part 6). Vẫn dừng khi tab ẩn.
- (2026-10-26) Danh sách Liên kết EA trên điện thoại có hai kiểu thẻ: **Card gọn** (mặc định) và **Card chi tiết** (như cũ). Lựa chọn nhớ ở `localStorage` khóa `az.links.cardMode` (giá trị `compact` | `detailed`; chỉ là sở thích giao diện, không nhạy cảm, cùng cách `az.theme` của Rules FE mục 7). Thẻ gọn chỉ giữ: số TK + sàn/tên, Balance, Lãi/lỗ đang mở, VPS; không có nút thao tác (Xem, Cấp lại khóa, Sửa VPS chỉ ở Card chi tiết), cả thẻ là liên kết sang trang chi tiết. Bảng trên màn hình rộng không đổi.

## 5. Việc còn nợ và rủi ro đã biết (chỉ append)

- [x] (2026-10-20: đã chọn Wouter 3, xem phần 4) **Chọn router (Wouter hoặc React Router) và ghi quyết định ở đây** — Rules FE mục 2 yêu cầu chốt ở Part 1; hiện chưa có router vì mới có một trang.
- [ ] Chưa cài shadcn/ui (Rules FE mục 2, 8); cài khi cần thành phần đầu tiên.
- [ ] Chưa có `lib/format.ts` (định dạng thời gian/tiền tệ — Rules FE mục 6), `lib/auth.ts`.
- [ ] Chưa xử lý 401 tự điều hướng về đăng nhập trong `api-client.ts` (cần khi có đăng nhập, Part 2/4).
- [ ] Chưa hỗ trợ giao diện sáng/tối (Rules FE mục 8).
- [ ] Chưa có cấu hình deploy `FE` (assets-only Worker) cho P1-24.
- [ ] Chưa có test e2e/trình duyệt; hiện chỉ test component bằng jsdom.
- [ ] Poll 30 giây và dừng khi tab ẩn (Rules FE mục 5) chưa áp dụng; `HealthPage` chỉ gọi một lần.
- [ ] Part 2: thay `FE/dev-mock-auth.ts` bằng xác thực thật của BE rồi xóa tệp này và dòng dùng nó trong `FE/vite.config.ts`; xóa `DevAuthHint`.
- [ ] Trang đăng ký và màn hình "chờ duyệt" (Plan 2 mục 6); hiện chỉ có đăng nhập.
- [ ] Chưa có kiểm tra Origin/CSRF phía FE cần thiết (thuộc BE, Part 2).
- [ ] (2026-10-20) Màn hình `Liên kết EA` (`FE/src/features/links`, trang `/links`, `/links/:id`) là bản thử Part 1, gọi `/api/dev/links`; chỉ có trong `pnpm dev` (`import.meta.env.DEV`, bản build không chứa). Part 3 thay bằng màn hình thật theo Plan 2 (phân quyền, giới hạn số TKGD); dùng lại `lib/format.ts`, `PresenceBadge`, `KeyDialog`.

## 6. Nhật ký (chỉ append, mới nhất ở cuối)

| Ngày | Ai/Agent | Mã mục | Việc đã làm | Bằng chứng | Vướng mắc |
|---|---|---|---|---|---|
| 2026-10-20 | Claude | P1-07 | Dựng `FE/` (Vite, React, Tailwind, TanStack Query), trang `HealthPage`, 2 test | `pnpm check` xanh trên bản clone sạch; commit `0691280` | Lần ghi đầu thiếu thư mục (brace expansion của `sh`); đã ghi lại |
| 2026-10-20 | Người dùng | P1-09 | Chạy `pnpm dev`, mở `localhost:5173` | Ảnh chụp: "API OK" | |
| 2026-10-20 | Claude | (tài liệu) | Tạo tệp workflow này | | |
| 2026-10-20 | Claude | P1-24 | Thêm `FE/wrangler.jsonc`, devDependency `wrangler`, script `deploy` (FE) và `deploy:web` (gốc) | `vite build` OK; `wrangler deploy --dry-run` đọc tệp assets | Chưa deploy thật (cần đăng nhập Cloudflare) |
| 2026-10-20 | Claude | X-FE-02..04 | Thêm Wouter, đăng nhập, `RequireAuth`, tổng quan, 404, giả lập đăng nhập dev | `pnpm check` xanh (Shared 26, BE 67, FE 10); dev server: login 200/401/403/429; `dist` không chứa tài khoản giả lập | Đăng nhập thật chờ Part 2; hình dạng API xem phần 4 |
| 2026-10-20 | Claude | X-FE-05 | Thêm menu Liên kết EA: danh sách, tạo liên kết + hộp thoại hiện khóa một lần, chi tiết (tài khoản, số liệu, lệnh, sự kiện), khóa/mở/gỡ gắn/xóa có xác nhận; `lib/format.ts` | `pnpm check` xanh (FE 22 test); `dist` không chứa `/api/dev/links` | Chưa có ảnh chụp màn hình; poll 30 giây theo Rules FE |
| 2026-10-20 | Claude | X-FE-06 | Danh sách ẩn cột khóa, thay bằng nút Cấp lại khóa (xác nhận + hộp thoại có nút Sao chép khóa/URL); hiện tên tài khoản MT5 trong danh sách; nút cũng có ở trang chi tiết | `pnpm check` xanh (FE 24 test) | |
| 2026-10-20 | Claude | X-FE-07 | Danh sách thêm cột Tên tài khoản và Balance (tách riêng); ô chọn chu kỳ tự làm mới + giờ cập nhật ở danh sách và chi tiết; nhãn "x giây trước" tự chạy bằng đồng hồ cục bộ (`useNow`) | `pnpm check` xanh (FE 28 test, gồm test tự cập nhật số liệu không cần bấm Làm mới); chạy thật EA giả 1 giây/lần: seq, balance, name đúng | Chưa chụp màn hình |
| 2026-10-22 | Claude | X-FE-3E | Plan 3E: huy hiệu máy chủ, banner failover, thẻ trạng thái máy chủ; `api-client` ghi header vai trò/chế độ | `tsc` FE sạch; chưa chạy test theo yêu cầu | Chưa có test riêng cho các thành phần mới |
| 2026-10-26 | Claude | X-FE-08 | Thẻ mobile Liên kết EA: thêm Card gọn (mặc định) và Card chi tiết, nút chọn `CardModeToggle`, nhớ bằng `localStorage` (`lib/card-mode.ts`); `LinksCompactCards.tsx`, `row-look.ts` (tách khỏi `LinksTable`), `MobileCard` thêm `dense`; chuỗi ở `lib/strings.ts` | ĐÃ CHẠY: FE 195 test xanh (184 cũ + 11 mới), `tsc` và `biome check` sạch; dựng bản build và chụp ảnh ở 375px (Chromium): thẻ gọn ≈129px, thẻ chi tiết ≈280-299px; chọn kiểu rồi tải lại trang vẫn giữ. CHƯA CHẠY: `pnpm check` toàn repo, thử trên điện thoại thật | Chưa có người dùng xác nhận trên máy thật |
| 2026-10-26 | Claude | X-FE-09 | Plan 5: chuông thông báo + bảng danh sách + "Đọc tất cả", form cài đặt ngưỡng và chế độ `growth_mode`; sửa test "đang chạy dự phòng" (thiếu mock `/api/health` nên khung "Không gọi được API" của `ApiStatusCard` che lỗi trong ô cài đặt; không phải lỗi UX, form hiện đúng message máy chủ) | ĐÃ CHẠY: FE 223 test xanh, `tsc` và `biome` sạch | CHƯA: thử tay giao diện sáng/tối và màn hình hẹp (Rules FE); thử trên điện thoại thật |
| 2026-10-27 | Claude | X-FE-10 | Giao dịch thủ công từ xa: `TradeControls.tsx` (nút Đóng/Đóng một phần/Sửa SL-TP trên từng lệnh, hộp xác nhận nêu ticket/symbol/khối lượng, công tắc bật cho admin), `live-store` lưu `trade_result` theo `cmd_id` (trần 20, không mất khi nối lại), margin theo mẫu `mg`, footer kiểu MT5. Thêm hạn chờ phía FE `TRADE_CLIENT_WAIT_MS` (28 giây) để không chờ mãi khi Gateway cũ không hiểu lệnh | ĐÃ CHẠY: FE 261 test xanh (thêm `trade-outcome.test.tsx`, `trade-store.test.ts`); `pnpm lint` và `typecheck` sạch | CHƯA CHẠY: chưa xem giao diện trên trình duyệt thật; chưa thử với EA thật (xem T-01..T-11) |
| 2026-10-27 | Claude | X-FE-11 | Giao dịch từ xa Pha 2: `OrderControls.tsx` (nút **Đặt lệnh** và **Đóng tất cả** ở đầu thẻ "Lệnh đang mở", chỉ admin và liên kết đã bật giao dịch, khóa khi terminal chưa Live). Hộp Đặt lệnh: chọn Market/Limit/Stop, Buy/Sell, mã, lot, giá vào (lệnh chờ), SL/TP; FE chặn mã sai, lot không hợp lệ, SL/TP sai phía giá vào (`pendingStopsOk`). Hộp Đóng tất cả: 5 bộ lọc, hiện trước số lệnh sẽ đóng (`matchesCloseAll`, tính cả swap), khóa xác nhận khi không khớp. `TradeOutcome` hiện ticket lệnh mới và số đóng được/lỗi. Chuỗi ở `lib/strings.ts` | ĐÃ CHẠY: FE 287 test xanh (261 cũ + 26 mới ở `order-controls.test.tsx`), `tsc` và `biome` sạch | CHƯA: thử tay giao diện trên trình duyệt thật; kết quả thật chỉ có khi EA 0.6.0 chạy trên MT5 demo |
| 2026-10-27 | Claude | X-FE-12 | PWA: `manifest.webmanifest`, `sw.js` (chỉ trang offline), `offline.html`, icon 192/512/maskable, `_headers`; `lib/pwa.ts`, `features/pwa/InstallBanner.tsx` (nút Cài ứng dụng, hướng dẫn iOS, mở trang cài từ Worker khi đang ở tunnel). `index.html` có thẻ manifest `data-az-pwa` mà Server VPS gỡ khi phục vụ (`Server/src/static.ts`) để chỉ cài được từ địa chỉ Worker cố định. `BE/wrangler.jsonc` bỏ tệp PWA khỏi `run_worker_first` | ĐÃ CHẠY: FE 314 test xanh (thêm `pwa.test.ts`, `install-banner.test.tsx`, `pwa-files.test.ts`), Server `static-pwa.test.ts`; `tsc` và `biome` sạch; build thật có đủ tệp PWA | CHƯA: cài thử trên Chrome desktop, Android, iOS Safari; thử `?az_stay=1` trên Worker thật. App mở xong vẫn nhảy sang origin tunnel (có thanh địa chỉ nhỏ) |
