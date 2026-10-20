# AZ Sentinel — Rules Backend (apps/api)

> v0.1 · 20/10/2026 · Áp dụng cho `apps/api` và phần dùng chung trong `packages/shared`.
> Mỗi quy tắc là bắt buộc trừ khi có ghi chú “nên”. Cần ngoại lệ thì ghi lý do vào commit hoặc PR.

## 1. Nguyên tắc nền

1. **Không tin dữ liệu từ EA hay từ trình duyệt.** Mọi đầu vào đều qua zod trước khi dùng.
2. **Ít dòng ghi nhất có thể.** Hạn mức D1 free là 100.000 dòng ghi mỗi ngày; mọi thay đổi ở đường ghi phải kèm số dòng ghi dự kiến.
3. **Đường nóng (ingest) phải rẻ và dự đoán được.** Một truy vấn đọc, một batch ghi.
4. **An toàn trước tiện lợi.** Phân quyền, giới hạn kích thước và escape được làm từ đầu, không để sau.
5. **Idempotent.** Gửi lại cùng một yêu cầu không được tạo dữ liệu trùng hay thay đổi kết quả.

## 2. TypeScript và cấu trúc

- `strict: true`. Cấm `any` (dùng `unknown` rồi thu hẹp kiểu). Cấm `@ts-ignore`; nếu bắt buộc dùng `@ts-expect-error` kèm lý do.
- Phân tầng một chiều: `routes → services → db`. Route chỉ: đọc đầu vào đã validate, gọi service, định dạng phản hồi. Service chứa nghiệp vụ. `db/` chứa truy vấn.
- Route không viết SQL; service không đọc `c.req` (đối tượng Hono).
- Không import chéo từ `apps/web`. Mã dùng chung chỉ nằm ở `packages/shared`.
- Tên tệp `kebab-case.ts`; kiểu và class `PascalCase`; hàm và biến `camelCase`; hằng `UPPER_SNAKE_CASE`; cột DB `snake_case`.
- Một tệp một trách nhiệm, tệp quá khoảng 300 dòng thì tách.

## 3. API

- Đường dẫn: `/api/...`; EA dùng `/api/ea/v1/...` (có phiên bản). Đổi schema EA không tương thích thì tăng `v` và giữ N và N-1.
- JSON cho cả vào và ra. Phản hồi thành công trả dữ liệu trực tiếp; lỗi luôn theo một dạng:

```json
{ "error": { "code": "LINK_LIMIT_REACHED", "message": "Đã đạt giới hạn tài khoản giao dịch" } }
```

- `code` là chuỗi `UPPER_SNAKE_CASE` ổn định cho máy đọc; `message` cho người đọc, không chứa chi tiết nội bộ (tên bảng, stack trace).
- Mã HTTP: 200/201 thành công; 400 sai dữ liệu; 401 chưa xác thực; 403 không đủ quyền hoặc tài khoản chưa duyệt; 404 không tồn tại **hoặc không thuộc quyền xem** (không phân biệt, tránh lộ sự tồn tại); 409 xung đột; 413 body quá lớn; 429 quá tần suất; 5xx lỗi hệ thống.
- Mọi route có schema zod cho body, query và params qua `@hono/zod-validator`. Schema dùng chung với web nằm ở `packages/shared`.
- Danh sách phải có phân trang hoặc giới hạn (mặc định 50, tối đa 200).
- Thời gian trong API: **Unix giây (UTC)** dạng số. Không trả chuỗi ngày theo múi giờ.
- Không trả về `password_hash`, `key_hash`, `last_ip` của người khác, hay bất kỳ bí mật nào. Dùng hàm DTO tường minh, không trả nguyên dòng DB.

## 4. Xác thực và phân quyền

- Mật khẩu: băm bằng thuật toán chậm có salt (chốt theo kết quả Part 1); không bao giờ ghi log hay trả về.
- Session: cookie `HttpOnly; Secure; SameSite=Lax`, id ngẫu nhiên 32 byte, **chỉ lưu bản băm** trong DB; có hạn dùng.
- Mọi thao tác ghi (POST, PATCH, DELETE) từ trình duyệt kiểm tra header `Origin`.
- Phân quyền qua middleware dùng chung (`requireAuth`, `requireRole`); không kiểm tra vai trò rải rác bằng `if` trong route.
- **Mọi truy vấn dữ liệu của User đi qua hàm lọc theo chủ sở hữu hoặc vai trò.** Không viết truy vấn lấy dữ liệu theo `id` mà thiếu điều kiện chủ sở hữu.
- Quy tắc rootAdmin gốc (`is_protected = 1`): không xóa, không hạ vai trò, không khóa. Kiểm tra ở service **và** có trigger trong DB.
- Admin chỉ thao tác trên User; chỉ rootAdmin nâng/hạ Admin hoặc tạo rootAdmin.
- Người dùng không tự duyệt đăng ký của chính mình, không tự đổi vai trò hay giới hạn của mình.
- Mọi thao tác quản trị ghi `audit_log` trong cùng batch với thao tác đó.
- Giới hạn tần suất cho đăng nhập, đăng ký và ingest (theo IP và theo khóa).

## 5. API key của EA

- 32 byte ngẫu nhiên từ `crypto.getRandomValues`, mã hóa base64url. Chỉ lưu SHA-256 và 8 ký tự đầu.
- Hiện khóa đầy đủ **một lần** khi tạo hoặc xoay. Không có endpoint nào trả lại khóa.
- So sánh bản băm bằng truy vấn theo `key_hash` (không so sánh chuỗi khóa thô).
- Lần ingest đầu gắn khóa với (server, login); lệch về sau trả 409 và ghi sự kiện `auth_fail`.
- Không ghi API key vào log, sự kiện hay phản hồi lỗi.

## 6. Cơ sở dữ liệu (D1)

- **Migration:** chỉ thêm tệp mới, **không sửa tệp migration đã áp dụng**. Tên `NNNN_mo_ta.sql`. Mỗi migration chạy được ở cả local, staging và prod.
- Truy vấn luôn dùng tham số (`?`/`.bind()`). Cấm ghép chuỗi từ dữ liệu người dùng vào SQL.
- **Bảng nóng** (`link_state`): một dòng mỗi liên kết, **không đặt chỉ mục phụ**; không thêm cột bị cập nhật liên tục vào bảng khác.
- Bảng có khóa chính ghép và chủ yếu truy vấn theo khóa đó dùng `WITHOUT ROWID`.
- Mỗi chỉ mục mới phải ghi lý do và ước lượng số dòng ghi thêm (một chỉ mục thêm một dòng ghi cho mỗi lần chèn hoặc cập nhật cột được đánh chỉ mục).
- Gộp các lần ghi liên quan vào **một** `DB.batch([...])` (nguyên tử, một vòng gọi). Không ghi tuần tự từng câu trong vòng lặp.
- Không `SELECT *` trong đường nóng; chọn đúng cột.
- Truy vấn đọc phải dùng khóa chính hoặc chỉ mục; không quét bảng lớn (`equity_m5`, `trades`, `events`). Mọi truy vấn lịch sử có giới hạn thời gian và `LIMIT`.
- Xóa hoặc cập nhật số lượng lớn chia theo lô (khoảng 1.000-5.000 dòng mỗi câu).
- Dùng Drizzle cho CRUD quản trị. Đường ingest và cron dùng SQL thô trong `db/sql.ts`, mỗi câu có chú thích số dòng đọc/ghi dự kiến.
- Giá trị tiền tệ và giá lưu `REAL`; không tính toán tài chính quan trọng ở server (server chỉ lưu và hiển thị). Nếu cần cộng tổng ở nhiều tài khoản khác tiền tệ thì phải tách theo `currency`.

## 7. Đường ingest (hot path)

Thứ tự bắt buộc:

1. Từ chối body quá 64 KB trước khi đọc.
2. Validate zod; giới hạn số lệnh, độ dài chuỗi; ép kiểu số.
3. Một truy vấn tra khóa (`ea_links` JOIN `users` LEFT JOIN `link_state`).
4. Kiểm tra trạng thái và (server, login).
5. Loại trùng bằng (`sid`, `seq`) và deal ticket.
6. Một `DB.batch()` để ghi.
7. Trả `ack_seq` **chỉ sau khi** batch thành công; lỗi D1 trả 503 để EA giữ hàng đợi.

Quy tắc kèm theo:

- Dùng giờ nhận request cho `last_seen_at`; không dùng `ts_utc` của EA để tính online.
- Comment và nhãn VPS là dữ liệu không tin cậy: cắt độ dài, chuẩn hóa nhãn (viết hoa, chỉ ký tự cho phép), không diễn giải.
- Không gọi dịch vụ bên ngoài trong ingest.
- Không thêm công việc nặng vào ingest; việc nặng chuyển sang cron.

## 8. Cron

- CPU cron ở gói free là 10 ms: **việc nặng làm bằng một câu SQL**, không lặp trong mã.
- Cron phải idempotent (chạy hai lần liên tiếp không tạo sự kiện trùng).
- Phát hiện offline: chỉ ghi khi **chuyển trạng thái** (`presence` 0 → 1), không ghi cho từng lần quét.
- Dọn dữ liệu theo lô và có giới hạn thời gian chạy.

## 9. Lỗi và log

- Một middleware bắt lỗi toàn cục, trả dạng lỗi chuẩn (mục 3), không lộ chi tiết nội bộ ra ngoài.
- Log có cấu trúc (JSON) với `requestId`, `route`, `status`, `durationMs`.
- **Cấm log:** API key, mật khẩu, cookie, `password_hash`, toàn bộ body ingest.
- Lỗi xác thực của EA ghi vào `events` (loại `auth_fail`) nhưng giới hạn tần suất để không tự gây ghi dồn.
- `GET /api/health`: không cần xác thực, không lộ phiên bản hay cấu hình.

## 10. Bí mật và cấu hình

- Bí mật dùng `wrangler secret put`; local dùng `.dev.vars` (đã có trong `.gitignore`); chỉ commit `.dev.vars.example`.
- Không hard-code domain, ID, khóa trong mã; lấy từ `env`.
- Ba môi trường (dev, staging, prod) tách D1 và bí mật.
- CORS: mặc định **không bật** (cùng origin). Nếu bắt buộc, chỉ cho đúng domain của bạn.

## 11. Kiểm thử

- Công cụ: Vitest trong runtime Workers (`@cloudflare/vitest-pool-workers`).
- Bắt buộc có test cho: mọi quy tắc phân quyền (kể cả trường hợp bị từ chối), idempotent của ingest, giới hạn số TKGD, bảo vệ rootAdmin gốc, escape/độ dài dữ liệu EA.
- Mỗi lỗi đã sửa kèm một test tái hiện.
- Test ghi chép số `rows_written` kỳ vọng cho các đường ghi chính (chặn hồi quy gây ghi thừa).

## 12. Git và PR

- Commit nhỏ; thông điệp bắt đầu bằng mã mục kế hoạch (ví dụ `P2-05: ...`).
- Không commit `.dev.vars`, `.wrangler/`, `node_modules/`, file `.ex5`.
- Danh sách tự kiểm trước khi hợp nhất:
  - [ ] `pnpm check` xanh
  - [ ] Có test cho thay đổi
  - [ ] Truy vấn mới dùng tham số, có lọc quyền sở hữu
  - [ ] Đã ước lượng số dòng ghi/đọc nếu chạm bảng nóng
  - [ ] Không log dữ liệu nhạy cảm
  - [ ] Migration mới (nếu có) là tệp mới, chạy được từ DB trống

## 13. Cấm

- `any`, `eval`, `new Function`.
- Ghép chuỗi vào SQL.
- Sửa migration đã áp dụng.
- Trả nguyên dòng DB ra API.
- Thêm chỉ mục vào bảng nóng mà không ghi lý do.
- Gọi `fetch` ra ngoài trong đường ingest.
- Tạo tài khoản hoặc nâng quyền ngoài luồng đã định (đặc biệt rootAdmin).
- Lưu mật khẩu giao dịch hoặc investor password dưới mọi hình thức.
