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
| P1-24 | Deploy `FE` (chỉ assets) lên `workers.dev`; đo static assets không tính request | [ ] | | Chưa có `FE/wrangler.jsonc`. Chung với BE workflow. |

### Việc ngoài Plan (mã `X-FE-nn`)

| Mã | Việc | Trạng thái | Ngày | Ghi chú |
|---|---|---|---|---|
| X-FE-01 | Kiểm trạng thái lỗi/"Thử lại" của `HealthPage` trên trình duyệt thật (tắt BE rồi bật lại) | [ ] | | Hướng dẫn đã đưa cho người dùng; test tự động đã phủ trạng thái lỗi. |

## 4. Quyết định và lệch so với Plan (chỉ append)

- Tên thư mục thực tế `FE/` (Plan ghi `apps/web`); tên gói `@az-sentinel/web`.
- Tailwind v4 dùng plugin Vite (`@tailwindcss/vite`), không cần `tailwind.config`; `src/index.css` chỉ có `@import "tailwindcss"`.
- Test FE dùng Vitest + jsdom + `@testing-library/react`, đặt cạnh mã: `src/**/*.test.tsx`.
- Mọi gọi API qua `lib/api-client.ts` (`apiGet`), dữ liệu server qua TanStack Query (Rules FE mục 4). Chuỗi giao diện tập trung ở `lib/strings.ts` (Rules FE mục 6).
- Kiểu `HealthResponse`, `ApiErrorBody` lấy từ `@az-sentinel/shared`.

## 5. Việc còn nợ và rủi ro đã biết (chỉ append)

- [ ] **Chọn router (Wouter hoặc React Router) và ghi quyết định ở đây** — Rules FE mục 2 yêu cầu chốt ở Part 1; hiện chưa có router vì mới có một trang.
- [ ] Chưa cài shadcn/ui (Rules FE mục 2, 8); cài khi cần thành phần đầu tiên.
- [ ] Chưa có `lib/format.ts` (định dạng thời gian/tiền tệ — Rules FE mục 6), `lib/auth.ts`.
- [ ] Chưa xử lý 401 tự điều hướng về đăng nhập trong `api-client.ts` (cần khi có đăng nhập, Part 2/4).
- [ ] Chưa hỗ trợ giao diện sáng/tối (Rules FE mục 8).
- [ ] Chưa có cấu hình deploy `FE` (assets-only Worker) cho P1-24.
- [ ] Chưa có test e2e/trình duyệt; hiện chỉ test component bằng jsdom.
- [ ] Poll 30 giây và dừng khi tab ẩn (Rules FE mục 5) chưa áp dụng; `HealthPage` chỉ gọi một lần.

## 6. Nhật ký (chỉ append, mới nhất ở cuối)

| Ngày | Ai/Agent | Mã mục | Việc đã làm | Bằng chứng | Vướng mắc |
|---|---|---|---|---|---|
| 2026-10-20 | Claude | P1-07 | Dựng `FE/` (Vite, React, Tailwind, TanStack Query), trang `HealthPage`, 2 test | `pnpm check` xanh trên bản clone sạch; commit `0691280` | Lần ghi đầu thiếu thư mục (brace expansion của `sh`); đã ghi lại |
| 2026-10-20 | Người dùng | P1-09 | Chạy `pnpm dev`, mở `localhost:5173` | Ảnh chụp: "API OK" | |
| 2026-10-20 | Claude | (tài liệu) | Tạo tệp workflow này | | |
