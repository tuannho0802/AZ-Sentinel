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
| P1-30 | Điền `docs/spike-results.md` | [~] | 2026-10-20 | Đã tạo mẫu `Docs/spike-results.md` (số local P1-18 đã điền, mọi ô remote là `____`). **Chưa có số đo remote.** Lưu ý: thư mục thực tế là `Docs/` (chữ D hoa). |
| P1-31 | Xóa mã spike (`/api/_spike/*`, D1 spike, dữ liệu giả) | [ ] | | Gồm `BE/src/routes/spike.ts`, dòng mount trong `BE/src/app.ts`, `BE/test/integration/spike-hash.test.ts`. |
| P1-32 | Chốt quyết định cuối Part 1 | [ ] | | |
| P1-33 | Merge `part-1-spike` vào `main`, tag `part-1-done` | [ ] | | |

### Việc ngoài Plan (mã `X-BE-nn`)

| Mã | Việc | Trạng thái | Ngày | Ghi chú |
|---|---|---|---|---|
| X-BE-01 | Sửa `seed-link.ts` cho đường dẫn có dấu cách | [x] | 2026-10-20 | Dùng `--file=.wrangler/seed-link.sql` với `cwd` là `BE`. |
| X-BE-02 | Script remote cho P1-20..22: `pnpm db:migrate:remote`, `pnpm db:seed:remote`, `pnpm deploy:api`; `seed-link.ts --remote` | [x] | 2026-10-20 | ĐÃ CHẠY local (seed vẫn ổn, `pnpm check` xanh). **Phần `--remote` CHƯA CHẠY** vì cần đăng nhập Cloudflare. Khóa remote lưu ở `BE/.wrangler/remote-api-key.txt`. |
| X-BE-03 | IDE (VS Code + MQL Clangd) báo lỗi giả và biên dịch EA từ repo | [~] | 2026-10-20 | Nguyên nhân lỗi giả: `C_Cpp.intelliSenseEngine` bị đặt `"Disabled"` (sai hoa/thường, phải là `"disabled"`) nên C/C++ IntelliSense vẫn chạy. Đã sửa; thêm `ea/compile.ps1` + `.vscode/tasks.json` (Ctrl+Shift+B), Biome bỏ qua `.vscode`/tệp tự sinh, `.gitignore` các tệp MQL Clangd tự sinh. **CHƯA CHẠY** trên Windows (không có MetaEditor ở môi trường viết). |
| X-BE-04 | Sửa lỗi script `deploy:api`: dùng `pnpm --filter ... run deploy` | [x] | 2026-10-20 | Lỗi do X-BE-02: `pnpm ... deploy` gọi lệnh `deploy` có sẵn của pnpm (`ERR_PNPM_INVALID_DEPLOY_TARGET`) thay vì script `wrangler deploy`. ĐÃ CHẠY: `pnpm deploy:api --dry-run` và `pnpm deploy:web --dry-run` đều đúng. |
| X-BE-05 | Sửa test chập chờn `equity_m5 chỉ có một dòng cho mỗi nến M5` | [x] | 2026-10-20 | Test gửi `ts` và `ts + 10`, sai khi chạy trong 10 giây cuối của nến M5 (~3% số lần). Đã căn `ts` về đầu nến. Lỗi này nằm trong 62 test BE ban đầu, không phải lỗi logic của BE. |
| X-BE-06 | `Shared/src/auth-schema.ts`: `loginRequestSchema`, `MeResponse`, `USER_ROLES`, `USER_STATUSES` + 7 test | [x] | 2026-10-20 | ĐÃ CHẠY: Shared 26 test xanh. Chuẩn bị cho Part 2; mật khẩu khi đăng nhập không áp độ dài tối thiểu (quy tắc mật khẩu thuộc đăng ký). |

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
- [ ] Chạy một lần `git rm --cached --ignore-unmatch .clangd .clang-format compile_commands.json -r .mql-auto-forwards` để Git ngừng theo dõi tệp tự sinh (giữ nguyên tệp trên máy). `.vscode/settings.json` vẫn được theo dõi nhưng chứa đường dẫn riêng của máy (`c:/Users/Admin/...`); cân nhắc bỏ theo dõi sau.
- [ ] Part 2: BE cần cung cấp `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/me` đúng hợp đồng ghi ở `AZ_Sentinel_FE_Workflow.md` phần 4 (FE đã viết sẵn). Chốt hướng băm mật khẩu sau khi có số đo P1-23 (Plan 2 mục "Mật khẩu"); không viết băm mật khẩu trước đó.
- [ ] (2026-10-20) XÓA khi có Part 2/3: `BE/src/routes/dev-links.ts`, dòng `/api/dev` trong `BE/src/app.ts`, `--var DEV_LINKS_API:1` trong script `dev` của `BE/package.json`, `BE/test/integration/dev-links.test.ts`, kiểu trong `Shared/src/links-schema.ts` (giữ nếu API thật dùng lại). API này KHÔNG có xác thực; chỉ an toàn vì bật bằng cờ lúc chạy `wrangler dev`. Không bao giờ đặt `DEV_LINKS_API` trong `wrangler.jsonc` hay secret.

## 6. Nhật ký (chỉ append, mới nhất ở cuối)

| Ngày | Ai/Agent | Mã mục | Việc đã làm | Bằng chứng | Vướng mắc |
|---|---|---|---|---|---|
| 2026-10-20 | Claude | P1-04..P1-06, P1-11, P1-13..P1-17 | Dựng monorepo, Shared, BE ingest, migration, seed, fake-ea, test BE | `pnpm check` xanh (81 test lúc đó) | Gói test đổi tên; Windows 10 chưa kiểm chứng lúc viết |
| 2026-10-20 | Người dùng | P1-08, P1-10, P1-12 | Áp patch BE trên Windows, cài, chạy check, migrate | Output `pnpm check` xanh sau `lint:fix` | Lỗi CRLF (45 file) và `pnpm` chưa cài; đã xử lý |
| 2026-10-20 | Claude + người dùng | X-BE-01, P1-13, P1-18 | Sửa seed cho đường dẫn có dấu cách; chạy seed và `fake-ea` | `fake-ea`: "Tất cả đạt." (7 tình huống) | Lỗi do `shell: true` không đặt nháy đường dẫn |
| 2026-10-20 | Claude | P1-19 | Thêm endpoint spike PBKDF2 + 5 test | `pnpm check`: 67 test BE xanh; commit `0691280` | Chưa đo thời gian trên remote |
| 2026-10-20 | Claude | (tài liệu) | Tạo tệp workflow này | | |
| 2026-10-20 | Claude | P1-26, X-BE-02 | Viết `ea/AZ_Spike.mq5`; thêm script migrate/seed/deploy remote và `--remote` cho `seed-link.ts` | `pnpm check` xanh (19 + 67 + 2); seed local chạy lại ổn; JSON mô phỏng qua zod | Không có MetaEditor/MT5 để biên dịch EA |
| 2026-10-20 | Claude | X-BE-03 | Sửa cấu hình IDE: `intelliSenseEngine` -> `disabled`, tắt `errorSquiggles`; thêm `ea/compile.ps1`, `.vscode/tasks.json`; Biome bỏ qua `.vscode` và tệp tự sinh; cập nhật `.gitignore` | `pnpm check` xanh; JSON hợp lệ | Chưa chạy `compile.ps1` trên Windows/MetaEditor thật |
| 2026-10-20 | Claude | X-BE-04, X-BE-05, P1-30 | Sửa `deploy:api`; thêm `deploy:web`; sửa test chập chờn; tạo mẫu `Docs/spike-results.md` | `--dry-run` hai script OK; `pnpm check` xanh | Đính chính X-BE-02: script `deploy:api` ghi ở đó chạy sai (xem X-BE-04) |
| 2026-10-20 | Claude | X-BE-06 | Thêm schema đăng nhập vào `Shared` | Shared 26 test xanh | BE chưa có endpoint xác thực (Part 2) |
| 2026-10-20 | Claude | X-BE-07 | Thêm `/api/dev/links` (danh sách, tạo, chi tiết, khóa/mở, gỡ gắn, xóa) để thử đăng ký EA bằng giao diện; bật bằng `--var DEV_LINKS_API:1` | `pnpm check` xanh (BE 83 test, gồm ingest end-to-end qua khóa vừa tạo); chạy thật `wrangler dev`: tạo khóa, ingest gắn tài khoản, danh sách hiện số liệu; không cờ thì 404 | Không có xác thực, chỉ dùng local |
| 2026-10-20 | Claude | X-BE-08 | Thêm `POST /api/dev/links/:id/rotate-key` (cấp lại khóa: khóa cũ vô hiệu, giữ tài khoản đã gắn) | `pnpm check` xanh (BE 85 test); chạy thật: khóa mới 200, khóa cũ 401 | DB chỉ lưu băm nên không thể lấy lại khóa cũ; đây là lý do dùng cấp lại thay vì copy lại |
| 2026-10-22 | Claude | X-BE-3E | Plan 3E: thêm `Server/` (BE+LiveHub trên Node, SQLite), `HubStats.gateways`, mã lỗi `UPSTREAM_FAILED`/`READ_ONLY_FALLBACK`, `/api/sync/links`, URL dự phòng trong server-info, `version.ts`; Gateway có `cloudFallbackUrl` và tự quay về VPS | `tsc` BE/Shared/Server/Gateway sạch; chưa chạy test theo yêu cầu | Cần thử thật WebSocket và failover; xem `Docs/AZ_Sentinel_Plan3E_VPS_Primary.md` |
| 2026-10-26 | Claude | X-BE-09 | Plan 5 (part 2): `growth_mode` (`balance`/`float`) xuyên suốt Shared, BE (migration 0009, `decideAlert`, service, route `/api/settings/alerts`, đồng bộ), Gateway (`alert_cfg`, `alert_bp`, `/v1/alert`, hàng chờ gửi lại), EA 0.4.0; sửa test Shared `server-schema` lỗi thời từ part 1 (thiếu 3 mảng alert) | ĐÃ CHẠY: Shared 119, BE 313, Server 163, Gateway 186 test xanh; `pnpm lint` và typecheck sạch. Chi tiết: `Docs/AZ_Sentinel_Plan5_Notifications.md` | CHƯA: biên dịch EA và chạy A-01..A-07 trên MT5 demo; chưa tăng version/tag phát hành |
| 2026-10-27 | Claude | X-BE-10 | Giao dịch thủ công từ xa Pha 1 (đóng lệnh, đóng một phần, sửa SL/TP). **Quyết định mới đảo nguyên tắc "EA chỉ đọc" của Plan 1** (đã ghi ở `Docs/AZ_Sentinel_Plan1_EA.md` và `Docs/AZ_Sentinel_Remote_Trading.md`): `Shared/trade-schema.ts`, `gw-schema`/`live-schema` (tin `trade`, `trade_result`, trường `tr_*`), migration 0010 (`ea_links.trade_enabled` mặc định tắt, `trade_log`), `POST /api/links/:id/trade` và `/trade-enabled` (chỉ admin), `LiveHub.sendTrade`, Gateway (một lệnh mỗi terminal, hạn 15 giây, `/v1/trade_result`), EA 0.5.0 (`InpAllowRemoteTrading` mặc định tắt, `cmd_id` ghi nhớ trước khi gọi sàn, `mg` margin theo mẫu). Bản phát hành: Server 0.2.7, Gateway 0.3.5 | ĐÃ CHẠY: `pnpm lint` và `typecheck` sạch; test Shared 147, Gateway 213, Server 169, BE 356 xanh (thêm `trade-schema`, `ea-trade-contract`, `trade-sync-isolation`); đã thử đổi công tắc EA thành `true` và bỏ `MarkCmdDone` thì test an toàn đỏ | CHƯA CHẠY: EA 0.5.0 chưa biên dịch/chạy trên MT5, phải thử demo theo T-01..T-11 trong `Docs/AZ_Sentinel_Remote_Trading.md`. Route chưa kiểm phiên bản Gateway (nợ) |
| 2026-10-27 | Claude | X-BE-11 | Giao dịch thủ công từ xa Pha 2: đóng hàng loạt (`close_all`: tất cả/lãi/lỗ/Buy/Sell), lệnh Market, lệnh chờ Limit/Stop kèm SL/TP. `Shared/trade-schema.ts` (op `market`/`pending`/`close_all`, `pendingStopsOk`, `matchesCloseAll`, `minEaVerForOp`, `SYMBOL_RE`, kết quả `order`/`n_ok`/`n_fail`), `gw-schema` (trường `tr_sym`/`tr_side`/`tr_kind`/`tr_px`/`tr_filter`), migration 0011 (`trade_log` nhận op mới, `ticket` cho phép rỗng, thêm `symbol`/`kind`/`price`), route `/trade` kiểm EA >= 0.6.0 theo từng op, hub chuyển nguyên trường lệnh, Gateway kiểm trường bắt buộc theo op, EA 0.6.0 (`InpAllowRemoteOpen` mặc định tắt, `InpMaxRemoteVolume` 1.0). Bản phát hành: Server 0.2.8, Gateway 0.3.6 | ĐÃ CHẠY: `biome check` và `typecheck` sạch; test Shared 194, Gateway 238, Server 169, BE 393, FE 287 xanh (thêm test Pha 2 ở `trade-schema`, `trade`, `ea-trade-contract`, `links-trade`, `live-hub-trade`, `order-controls`); sửa hai test cũ khẳng định "chưa có đường đặt lệnh mới" | CHƯA CHẠY: EA 0.6.0 chưa biên dịch/chạy trên MT5, phải thử demo theo T-12..T-19 trong `Docs/AZ_Sentinel_Remote_Trading.md`. Route chưa kiểm phiên bản Gateway (nợ cũ) |
| 2026-10-27 | Claude | X-BE-12 | Sửa lỗi mã thiết bị đổi mỗi lần Quick Tunnel đổi địa chỉ (cookie `az_dev` gắn theo tên miền tunnel nên trình duyệt cũ bị coi là thiết bị mới, phải duyệt lại). Plan 3K: Worker (`BE/src/edge/page-router.ts`) giữ cookie thiết bị ở địa chỉ cố định và gắn vé AES-GCM `az_dh` (`BE/src/edge/device-handoff.ts`, khóa từ `SYNC_TOKEN`, hạn 60 giây) vào 302 sang tunnel; Server (`Server/src/device-handoff.ts`, `http.ts`) giải vé, cấp lại cookie, chuyển hướng bỏ tham số, vé dùng một lần; hằng số/`deviceCookieHeader` ở `Shared/device-rules.ts`. Bản phát hành: Server 0.2.9 (Worker `[deploy]`) | ĐÃ CHẠY: `biome` và `typecheck` sạch; test BE 417 (thêm `device-handoff` và nhóm Plan 3K ở `page-redirect`), Server 181 (thêm `device-handoff`: đơn vị và hai máy chủ HTTP thật) xanh | CHƯA CHẠY: thử trên Worker và Quick Tunnel Cloudflare thật; sau nâng cấp mỗi trình duyệt là thiết bị mới đúng một lần (xem `Docs/AZ_Sentinel_Whitelist_IP.md`) |
| 2026-10-27 | Claude | X-BE-13 | Thiết bị "cùng máy": khi bật bảo vệ thiết bị, thiết bị web lạ (ví dụ app PWA đã cài, cookie riêng) đến từ IP mà một thiết bị web do quản trị viên duyệt vừa dùng (7 ngày) hoặc đã tự thêm vào whitelist thì được duyệt theo, thừa kế chế độ, nhãn `Cùng máy: ...`, tối đa 5 thiết bị mỗi IP, không duyệt dây chuyền, Gateway không bao giờ được duyệt kiểu này, tắt bằng `server_meta.device_adopt = '0'` (phải INSERT/upsert, chưa có lệnh `ip.cmd`; xem Whitelist_IP.md). Nút Bỏ không chặn hẳn: thiết bị gốc còn đủ điều kiện thì được duyệt lại. `Shared/device-rules.ts` (`DEVICE_ADOPT_*`), `Server/src/ip-guard.ts` (`adoptSameMachine`). Giữ nguyên Worker/D1 (chỉ Server VPS áp whitelist) | ĐÃ CHẠY: Shared 194, Server 211, BE 417, FE 314 test xanh (thêm `Server/test/device-adopt.test.ts`, 24 ca: gồm biên 7 ngày, hạn mức riêng từng IP, bảo vệ thiết bị tắt, nguồn `created_by` rỗng, nhãn, khởi động lại, Bỏ rồi được duyệt lại); `tsc` và `biome` sạch | CHƯA: thử thật: duyệt trình duyệt, cài app, mở app qua Worker rồi xem dòng `Cùng máy:` ở Whitelist thiết bị. IP dùng chung (Wi-Fi văn phòng) cũng được duyệt theo: chỉ nên bật khi mạng tin cậy |
