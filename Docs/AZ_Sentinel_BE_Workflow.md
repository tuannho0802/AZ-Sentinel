# AZ Sentinel — BE Workflow (theo dõi tiến độ BE, Shared, Scripts)

> Tệp theo dõi việc đã làm và chưa làm cho `BE/`, `Shared/`, `Scripts/` và `BE/migrations`. Phần FE theo dõi ở `AZ_Sentinel_FE_Workflow.md`.

## QUY TẮC WORKFLOW (đọc trước, không sửa phần này trừ khi chủ dự án yêu cầu)

1. **Chỉ append và sửa nhẹ, không xóa, không viết lại.** Mọi mục ở các phần 2-6 là bằng chứng theo dõi. Không xóa dòng, không đổi thứ tự, không gộp, không viết lại câu chữ của người trước.
2. **Được phép sửa duy nhất các thao tác sau:**
   - Đổi `[ ]` thành `[x]` ở bảng theo dõi (phần 3) và thêm ngày + bằng chứng vào cột tương ứng.
   - Thêm dòng mới vào cuối mỗi bảng/danh sách.
   - Khi một thông tin cũ sai: **không sửa dòng cũ**, thêm dòng mới ở Nhật ký (phần 6) có chữ "Đính chính" và nêu rõ dòng nào.
3. **Mã mục (P1-xx) lấy từ `AZ_Sentinel_Plan3_Implementation.md`.** Việc ngoài Plan thì đặt mã `X-BE-nn` (số tăng dần, không dùng lại) và ghi lý do.
4. **Mỗi lần làm việc xong, thêm một dòng vào Nhật ký (phần 6)** theo mẫu: `Ngày (YYYY-MM-DD) | Ai/Agent nào | Mã mục | Việc đã làm | Bằng chứng | Vướng mắc`.
5. **Chỉ ghi điều đã kiểm chứng.** Dùng nhãn: `ĐÃ CHẠY` (có output/test thực), `CHƯA CHẠY` (chỉ viết code), `NGƯỜI DÙNG XÁC NHẬN` (người dùng báo đã chạy). Không tick `[x]` cho mục chưa có bằng chứng.
6. **Không ghi bí mật vào tài liệu:** API key, token Cloudflare, `database_id` thật, mật khẩu. Chỉ ghi tiền tố 8 ký tự nếu cần.
7. **Đọc trước khi làm:** Plan 3 (mục đang làm), `AZ_Sentinel_Rules_BE.md`, tệp này (phần 4-5 để biết lệch so với Plan và việc còn nợ).
8. **Không đổi ngữ cảnh đã chốt** (tên thư mục, tên gói, quyết định ở phần 4) nếu chưa có quyết định mới ghi vào Nhật ký.
9. Văn bản bằng tiếng Việt. Đường dẫn, lệnh, mã dùng định dạng code.
10. Tệp này chỉ cho BE/Shared/Scripts. Việc FE ghi ở tệp FE; việc chéo cả hai ghi ở cả hai tệp, mỗi nơi một dòng.

## 1. Bối cảnh cố định (chỉ append)

- Repo: `https://github.com/tuannho0802/AZ-Sentinel`. Monorepo pnpm: `BE/` (`@az-sentinel/api`), `FE/` (`@az-sentinel/web`), `Shared/` (`@az-sentinel/shared`), `Scripts/`.
- BE: Hono + Cloudflare D1 (Workers). Test chạy trong runtime Workers bằng `@cloudflare/vitest-plugin`.
- Lệnh chính (chạy từ gốc repo): `pnpm check`, `pnpm dev`, `pnpm db:migrate:local`, `pnpm db:seed:local`, `pnpm fake-ea`.
- Máy phát triển của chủ dự án: Windows 10, đường dẫn có dấu cách (`D:\Du An Az\AZ-Sentinel`).

## 2. Chú giải trạng thái

`[x]` xong và có bằng chứng · `[ ]` chưa làm · `[~]` làm một phần (ghi rõ phần còn thiếu ở cột Ghi chú).

## 3. Bảng theo dõi theo mã mục Plan 3 (Part 1)

| Mã | Việc | Trạng thái | Ngày | Bằng chứng / Ghi chú |
|---|---|---|---|---|
| P1-04 | Tệp gốc repo | [~] | 2026-10-20 | Có `package.json`, `pnpm-workspace.yaml`, `biome.json`, `tsconfig.base.json`, lockfile. **Thiếu `README.md`.** Đã có trong repo: `.node-version`, `.gitignore`, `.gitattributes`, `.editorconfig`. |
| P1-05 | `Shared`: schema zod ingest v1 + test | [x] | 2026-10-20 | ĐÃ CHẠY: 19 test xanh (ingest-schema, vps-label, errors). |
| P1-06 | BE: Hono, `/api/health`, `wrangler.jsonc` D1, Vitest trong Workers | [x] | 2026-10-20 | ĐÃ CHẠY: `pnpm check` xanh; `curl /api/health` trả `{"status":"ok"}`. |
| P1-08 | `pnpm install` thành công | [x] | 2026-10-20 | NGƯỜI DÙNG XÁC NHẬN (Windows 10). |
| P1-10 | `pnpm check` xanh, commit đầu đẩy GitHub | [x] | 2026-10-20 | NGƯỜI DÙNG XÁC NHẬN: lint + typecheck + test xanh sau `pnpm lint:fix` (lỗi CRLF). Hash cần điền vào Plan 3. |
| P1-11 | Migration ban đầu | [x] | 2026-10-20 | Tệp thực tế là `BE/migrations/0001_init_ingest.sql` (khác tên `0001_spike.sql` trong Plan; xem phần 4). |
| P1-12 | Áp migration local | [x] | 2026-10-20 | NGƯỜI DÙNG XÁC NHẬN: "8 commands executed successfully". |
| P1-13 | Script seed liên kết giả | [x] | 2026-10-20 | `Scripts/seed-link.ts`; người dùng chạy thành công sau khi sửa lỗi đường dẫn có dấu cách (xem Nhật ký). |
| P1-14 | `POST /api/ea/v1/ingest` (body limit, zod, tra khóa, loại trùng, một `DB.batch()`) | [x] | 2026-10-20 | ĐÃ CHẠY: 62 test BE xanh. |
| P1-15 | Meta `rows_written`/`rows_read` ở dev/spike | [x] | 2026-10-20 | Biến `INGEST_DEBUG_META="1"` trong `wrangler.jsonc`. **Tắt ở staging/prod.** |
| P1-16 | `Scripts/fake-ea.ts` | [x] | 2026-10-20 | Tên/đường dẫn thực tế: `Scripts/fake-ea.ts` (Plan ghi `scripts/`). |
| P1-17 | Test tự động ingest (trùng seq, 401, 403, 409) | [x] | 2026-10-20 | ĐÃ CHẠY: nằm trong `BE/test/integration/ingest-*.test.ts`. |
| P1-18 | Chạy `fake-ea` local, điền số đo | [~] | 2026-10-20 | NGƯỜI DÙNG XÁC NHẬN: 7 tình huống đều ĐẠT, dòng ghi 3/1/2/3/0. **Còn thiếu:** điền bảng số đo vào Plan 3 mục P1-18. |
| P1-19 | Endpoint spike `/api/_spike/hash?iter=N` (PBKDF2) | [~] | 2026-10-20 | Code + 5 test xong (`BE/src/routes/spike.ts`). **Chưa đo** 10.000/50.000/100.000 vòng (cần remote, P1-23). **Phải xóa ở P1-31.** |
| P1-20 | `wrangler login`, tạo D1 remote, điền `database_id` | [ ] | | Chủ dự án thao tác; `database_id` đang là ID giả. |
| P1-21 | Migration remote + deploy API | [ ] | | |
| P1-22 | `fake-ea` vào `workers.dev` (~100 request), đo CPU time | [ ] | | |
| P1-23 | Đo `/api/_spike/hash` remote (3 mức x 10 lần) | [ ] | | |
| P1-24 | Deploy `FE` (chỉ assets), kiểm static assets không tính request | [ ] | | Chung với FE workflow. |
| P1-25 | Đối chiếu dòng ghi/đọc D1 dashboard với dự báo | [ ] | | |
| P1-26 | `ea/AZ_Spike.mq5` | [~] | 2026-10-20 | CHƯA CHẠY: đã viết (OnTimer 10 giây, `JsonEscape`, in mã trả về và `GetLastError()`), **chưa biên dịch trong MetaEditor**. JSON mô phỏng đã qua schema zod. Tệp UTF-8 có BOM. |
| P1-27 | Chạy MT5 demo gọi `workers.dev` | [ ] | | |
| P1-28 | Ghi mã `GetLastError()` thực tế khi chưa cho phép URL | [ ] | | |
| P1-29 | (Tùy chọn) MT5 gọi `127.0.0.1:8787` | [ ] | | |
| P1-30 | Điền `docs/spike-results.md` | [ ] | | Lưu ý: thư mục thực tế là `Docs/` (chữ D hoa). |
| P1-31 | Xóa mã spike (`/api/_spike/*`, D1 spike, dữ liệu giả) | [ ] | | Gồm `BE/src/routes/spike.ts`, dòng mount trong `BE/src/app.ts`, `BE/test/integration/spike-hash.test.ts`. |
| P1-32 | Chốt quyết định cuối Part 1 | [ ] | | |
| P1-33 | Merge `part-1-spike` vào `main`, tag `part-1-done` | [ ] | | |

### Việc ngoài Plan (mã `X-BE-nn`)

| Mã | Việc | Trạng thái | Ngày | Ghi chú |
|---|---|---|---|---|
| X-BE-01 | Sửa `seed-link.ts` cho đường dẫn có dấu cách | [x] | 2026-10-20 | Dùng `--file=.wrangler/seed-link.sql` với `cwd` là `BE`. |
| X-BE-02 | Script remote cho P1-20..22: `pnpm db:migrate:remote`, `pnpm db:seed:remote`, `pnpm deploy:api`; `seed-link.ts --remote` | [x] | 2026-10-20 | ĐÃ CHẠY local (seed vẫn ổn, `pnpm check` xanh). **Phần `--remote` CHƯA CHẠY** vì cần đăng nhập Cloudflare. Khóa remote lưu ở `BE/.wrangler/remote-api-key.txt`. |

## 4. Quyết định và lệch so với Plan (chỉ append)

- Tên thư mục thực tế `BE/`, `FE/`, `Shared/`, `Scripts/` (Plan ghi `apps/api`, `apps/web`, `packages/shared`, `scripts`). Tên gói: `@az-sentinel/api`, `@az-sentinel/web`, `@az-sentinel/shared`.
- Gói test Workers là `@cloudflare/vitest-plugin` (gói cũ `@cloudflare/vitest-pool-workers` đã đổi tên và ngừng cập nhật). **Rules BE mục 11 vẫn ghi tên cũ, cần sửa** (xem phần 5).
- Phiên bản dùng `latest` rồi ghim bằng lockfile (Plan 2 mục 3.1). TypeScript hiện 7.0.2.
- Migration đặt tên `0001_init_ingest.sql` thay vì `0001_spike.sql`.
- Ingest theo thứ tự Rules BE mục 7: giới hạn 64 KB, zod, tra khóa, kiểm (server, login), loại trùng, một `DB.batch()`.
- Dùng Biome với LF bắt buộc (`.gitattributes`). Trên Windows nếu gặp lỗi format CRLF: `pnpm lint:fix`, và `git config core.autocrlf false`.

## 5. Việc còn nợ và rủi ro đã biết (chỉ append)

- [ ] Sửa Rules BE mục 11: đổi tên gói test sang `@cloudflare/vitest-plugin`.
- [ ] Thêm `README.md` gốc (P1-04).
- [ ] Điền bảng số đo P1-18 và hash commit P1-10 vào Plan 3; điền Nhật ký tiến độ (Plan 3 mục 8).
- [ ] Part 2: bảng `users` và kiểm tra trạng thái User; hiện `owner_id` chưa có khóa ngoại.
- [ ] Part 3: đóng một phần lệnh (nhiều deal đóng một position) chưa xử lý.
- [ ] `database_id` trong `wrangler.jsonc` là ID giả; thay bằng ID thật ở P1-20 (không commit ID thật vào chỗ công khai nếu repo public).
- [ ] `INGEST_DEBUG_META` phải tắt ngoài môi trường spike.
- [ ] `seed-link.ts` dùng `spawnSync(..., { shell: true })` gây cảnh báo Node `DEP0190`; xử lý khi có dịp, hiện không ảnh hưởng.
- [ ] Wrangler chính thức chỉ hỗ trợ Windows 11; Windows 10 đã chạy được `wrangler dev`. Nếu `workerd` lỗi thì dùng WSL2.
- [ ] Biên dịch `ea/AZ_Spike.mq5` trong MetaEditor và sửa lỗi cú pháp nếu có (P1-26 chưa được biên dịch).
- [ ] Khi thử MT5 (P1-27) dùng một khóa remote **tạo riêng, không truyền `--login/--server`** để khóa tự gắn vào tài khoản MT5 ở lần gửi đầu; khóa dùng cho `fake-ea` là khóa khác.
- [ ] Chưa biết MT5 có chấp nhận URL có cổng (vd `127.0.0.1:8787`) trong danh sách Allow WebRequest hay không; P1-29 sẽ xác nhận.

## 6. Nhật ký (chỉ append, mới nhất ở cuối)

| Ngày | Ai/Agent | Mã mục | Việc đã làm | Bằng chứng | Vướng mắc |
|---|---|---|---|---|---|
| 2026-10-20 | Claude | P1-04..P1-06, P1-11, P1-13..P1-17 | Dựng monorepo, Shared, BE ingest, migration, seed, fake-ea, test BE | `pnpm check` xanh (81 test lúc đó) | Gói test đổi tên; Windows 10 chưa kiểm chứng lúc viết |
| 2026-10-20 | Người dùng | P1-08, P1-10, P1-12 | Áp patch BE trên Windows, cài, chạy check, migrate | Output `pnpm check` xanh sau `lint:fix` | Lỗi CRLF (45 file) và `pnpm` chưa cài; đã xử lý |
| 2026-10-20 | Claude + người dùng | X-BE-01, P1-13, P1-18 | Sửa seed cho đường dẫn có dấu cách; chạy seed và `fake-ea` | `fake-ea`: "Tất cả đạt." (7 tình huống) | Lỗi do `shell: true` không đặt nháy đường dẫn |
| 2026-10-20 | Claude | P1-19 | Thêm endpoint spike PBKDF2 + 5 test | `pnpm check`: 67 test BE xanh; commit `0691280` | Chưa đo thời gian trên remote |
| 2026-10-20 | Claude | (tài liệu) | Tạo tệp workflow này | | |
| 2026-10-20 | Claude | P1-26, X-BE-02 | Viết `ea/AZ_Spike.mq5`; thêm script migrate/seed/deploy remote và `--remote` cho `seed-link.ts` | `pnpm check` xanh (19 + 67 + 2); seed local chạy lại ổn; JSON mô phỏng qua zod | Không có MetaEditor/MT5 để biên dịch EA |
