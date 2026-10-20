# AZ Sentinel — Rules Frontend (apps/web)

> v0.1 · 20/10/2026 · Áp dụng cho `apps/web`. Ứng dụng là SPA React + Vite, phục vụ bằng static assets của một Worker riêng, gọi API cùng origin tại `/api/*`.
> Mỗi quy tắc là bắt buộc trừ khi có ghi chú “nên”.

## 1. Nguyên tắc nền

1. **Giao diện chỉ là lớp hiển thị.** Mọi quyết định phân quyền thật nằm ở BE; FE chỉ ẩn/hiện cho đúng ngữ cảnh.
2. **Không tin dữ liệu nhận về.** Comment, nhãn VPS, tên broker đều do EA gửi; luôn coi là văn bản thuần.
3. **Tiết kiệm request.** Mỗi lượt poll là một request tính vào hạn mức; poll đúng chỗ, đúng nhịp, dừng khi tab ẩn.
4. **Mọi màn hình có đủ ba trạng thái:** đang tải, lỗi, rỗng.
5. **Đơn giản trước.** Không thêm thư viện khi mã hiện có và thư viện đã chọn làm được.

## 2. Ngăn xếp (đã chốt)

React, TypeScript (strict), Vite, TanStack Query, Wouter (hoặc React Router — chọn một ở Part 1 và giữ nguyên), Tailwind CSS, shadcn/ui, Lightweight Charts hoặc Recharts (chọn một ở Part 5). Thêm thư viện mới cần ghi lý do vào PR.

## 3. TypeScript và cấu trúc

- `strict: true`. Cấm `any` và `@ts-ignore`.
- Không import từ `apps/api`. Kiểu và schema dùng chung nằm ở `packages/shared`.
- Cấu trúc theo tính năng:

```
src/
├─ pages/          # một tệp mỗi route; chỉ ghép các feature
├─ features/       # overview/, vps/, link-detail/, my-links/, admin/, auth/
│  └─ <feature>/   # components/, hooks/, api.ts, types.ts
├─ components/     # thành phần dùng chung, không biết nghiệp vụ (Button, Table, StatusDot...)
├─ lib/            # api-client.ts, format.ts, query-client.ts, auth.ts
└─ main.tsx
```

- Component là hàm; một tệp một component chính; tên `PascalCase.tsx`. Hook bắt đầu bằng `use`. Tệp khác dùng `kebab-case.ts`.
- Component dài quá khoảng 200 dòng thì tách. Logic phức tạp tách ra hook.

## 4. Gọi API và dữ liệu

- **Mọi lời gọi API đi qua `lib/api-client.ts`.** Cấm `fetch` trực tiếp trong component.
- Client luôn gửi `credentials: 'same-origin'`, xử lý lỗi chuẩn `{ error: { code, message } }`, và tự điều hướng về đăng nhập khi gặp 401.
- Dữ liệu từ server quản lý bằng **TanStack Query**, không lưu bản sao vào `useState`/Context. Đặt `queryKey` có cấu trúc (ví dụ `['links', id, 'trades', { page }]`).
- Kiểu phản hồi lấy từ `packages/shared`; kiểm tra bằng zod ở biên nếu dữ liệu quan trọng.
- Thao tác ghi dùng `useMutation`; sau khi thành công thì làm mới đúng query liên quan (không làm mới toàn bộ).
- Không để lộ API key đầy đủ ngoài khoảnh khắc hiển thị một lần; không lưu vào query cache, localStorage hay log.

## 5. Poll và thời gian thực

- Dashboard poll **30 giây** (`refetchInterval: 30_000`) và **dừng khi tab ẩn** (`refetchIntervalInBackground: false`, mặc định).
- Chỉ màn hình đang mở mới poll; rời màn hình thì dừng.
- Không poll song song nhiều endpoint nặng; ưu tiên một endpoint tổng hợp (`/api/overview`) thay vì nhiều endpoint nhỏ.
- Không tự rút ngắn chu kỳ poll dưới 30 giây mà không có quyết định ghi ở Plan (ảnh hưởng hạn mức request và dòng đọc).
- Khi chuyển sang SSE/WebSocket (Part 6), thay thế poll chứ không chạy song song.

## 6. Hiển thị dữ liệu

- **Thời gian:** API trả Unix giây (UTC); FE định dạng sang múi giờ người dùng ở `lib/format.ts`. Hiển thị “last seen” dạng tương đối (vừa xong, 3 phút trước) kèm giờ đầy đủ khi rê chuột.
- **Online/offline:** FE không tự tính từ `last_seen_at`; dùng trạng thái server trả về để tránh lệch đồng hồ.
- **Số:** định dạng tiền tệ và số thập phân tập trung ở `lib/format.ts`; luôn kèm đơn vị tiền tệ của tài khoản; không cộng gộp số của các tài khoản khác tiền tệ.
- Lãi/lỗ: màu xanh/đỏ **kèm dấu +/−** (không dựa vào màu duy nhất).
- Văn bản giao diện tiếng Việt, đặt trong một nơi tập trung (`lib/strings.ts`) để sửa dễ; không rải chuỗi cố định khắp mã.

## 7. Bảo mật FE

- React tự escape nội dung. **Cấm `dangerouslySetInnerHTML`.** Comment, nhãn VPS, tên broker hiển thị dưới dạng văn bản thuần.
- Cấm `eval`, `new Function`, nhúng script bên ngoài.
- Không lưu token hay thông tin nhạy cảm ở `localStorage`/`sessionStorage`. Phiên dùng cookie `HttpOnly` do server cấp, FE không đọc được.
- Ẩn/hiện chức năng theo vai trò (ví dụ mục Quản trị) chỉ để tiện dùng; không coi đó là bảo vệ.
- Liên kết ra ngoài dùng `rel="noopener noreferrer"`.
- Không đưa bí mật hay khóa vào biến `VITE_*` (mọi giá trị này nằm trong gói gửi cho trình duyệt).

## 8. UI/UX

- Dùng thành phần shadcn/ui và Tailwind; không viết CSS riêng trừ khi cần (nếu cần, đặt trong tệp riêng của component).
- Màn hình tổng quan phải đọc được trong vài giây: trạng thái online/offline, VPS và số liệu chính nằm cùng một hàng.
- Bảng dài có sắp xếp, lọc nhanh theo nhãn VPS/số tài khoản, và phân trang hoặc cuộn ảo.
- Trạng thái:
  - **Tải:** khung xương (skeleton) hoặc chỉ báo, không để trống.
  - **Lỗi:** thông điệp rõ ràng kèm nút thử lại.
  - **Rỗng:** giải thích và hướng dẫn bước tiếp theo (ví dụ “Chưa có liên kết EA. Tạo liên kết đầu tiên”).
- Thao tác nguy hiểm (xóa User, xoay khóa, khóa liên kết) có hộp thoại xác nhận nêu rõ hậu quả.
- Khóa API hiển thị một lần, có nút sao chép và cảnh báo “không xem lại được”.
- Responsive: dùng được trên điện thoại (xem nhanh trạng thái); bảng rộng cuộn ngang trong khung riêng.
- Hỗ trợ giao diện sáng/tối; màu lấy từ biến thiết kế của Tailwind/shadcn.

## 9. Truy cập (a11y)

- Phần tử tương tác là `button`/`a` đúng nghĩa; có nhãn cho input; điều hướng được bằng bàn phím và thấy rõ focus.
- Trạng thái online/offline có chữ hoặc biểu tượng kèm màu.
- Hộp thoại dùng thành phần shadcn/Radix (đã xử lý bẫy focus).

## 10. Hiệu năng

- Cắt theo route (`React.lazy`) cho các trang nặng (biểu đồ, quản trị).
- Biểu đồ chỉ tải khi mở trang chi tiết; không vẽ lại khi dữ liệu không đổi (`useMemo` cho dữ liệu chuyển đổi nặng).
- Danh sách lớn dùng khóa (`key`) ổn định, không dùng chỉ số mảng nếu thứ tự thay đổi.
- Giữ kích thước gói nhỏ; kiểm tra bằng báo cáo build khi thêm thư viện.

## 11. Xác thực phía FE

- Trạng thái đăng nhập lấy từ `GET /api/me` (TanStack Query), không tự lưu.
- Route cần đăng nhập có bộ bảo vệ chuyển về trang đăng nhập; User `pending` thấy màn hình “chờ duyệt”; `suspended`/`rejected` thấy thông báo tương ứng.
- Đăng xuất gọi API rồi xóa toàn bộ query cache.

## 12. Kiểm thử

- Vitest + Testing Library cho hook và component có logic (định dạng, bộ bảo vệ route, hiển thị trạng thái).
- Test các trạng thái tải/lỗi/rỗng của màn hình chính.
- Kiểm tra thủ công trước khi hợp nhất: giao diện sáng và tối, màn hình hẹp, trạng thái offline.
- Test an toàn: hiển thị một comment chứa `<script>` và dấu nháy phải ra dạng văn bản.

## 13. Git và PR

- Commit nhỏ, bắt đầu bằng mã mục kế hoạch (ví dụ `P4-03: bảng tổng quan`).
- Danh sách tự kiểm trước khi hợp nhất:
  - [ ] `pnpm check` xanh
  - [ ] Có đủ ba trạng thái tải/lỗi/rỗng
  - [ ] Không `fetch` trực tiếp trong component
  - [ ] Không `dangerouslySetInnerHTML`, không lưu bí mật ở trình duyệt
  - [ ] Poll đúng nhịp và dừng khi tab ẩn
  - [ ] Xem được trên màn hình hẹp và chế độ tối
  - [ ] Chuỗi tiếng Việt nằm ở `lib/strings.ts`

## 14. Cấm

- `any`, `dangerouslySetInnerHTML`, `eval`.
- `fetch` trực tiếp trong component.
- Sao chép dữ liệu server vào state cục bộ để “đồng bộ tay”.
- Lưu token/khóa ở `localStorage`/`sessionStorage`.
- Tự tính trạng thái online từ giờ trình duyệt.
- Cộng gộp số dư của các tài khoản khác tiền tệ.
- Poll dưới 30 giây hoặc poll khi tab ẩn.
