# AZ Sentinel — Kết quả Spike Part 1 (P1-30, P1-32)

> Mẫu do Claude tạo ngày 2026-10-20. **Mọi ô `____` là chưa đo, không được điền ước lượng.** Chỉ điền số đo thật và ghi nguồn (dashboard, log, lệnh). Tham chiếu: `AZ_Sentinel_Plan3_Implementation.md` mục 5 và 6. Quy tắc cập nhật: chỉ điền ô trống và thêm dòng mới, không xóa số đo cũ (đo lại thì thêm dòng "đo lại").

## 1. Số dòng ghi D1 mỗi lần ingest (P1-18)

Nguồn: `pnpm fake-ea` chạy với `wrangler dev` (D1 local), meta `rows_written` trong phản hồi. Ngày 2026-10-20, NGƯỜI DÙNG XÁC NHẬN: tất cả 7 tình huống ĐẠT.

| Tình huống | Dòng ghi dự kiến | Dòng ghi thực tế (local) | Ghi chú |
|---|---|---|---|
| heartbeat | 1 | 1 | Lần đầu của khóa là 3 vì có thêm bước gắn tài khoản |
| m5_bar | 2 | 2 | |
| m5_bar + 1 sự kiện đóng lệnh | 3 | 3 | |
| gửi trùng `seq` | 0 | 0 | phản hồi `duplicate: true` |

Còn thiếu: số liệu tương ứng trên D1 remote (P1-25).

## 2. CPU time ingest trên Cloudflare (P1-22)

Cách đo: `pnpm fake-ea -- --url https://<worker>.workers.dev --key <khóa>` (khoảng 100 request, rải rác), đọc Workers Metrics/Logs.

| Chỉ số | Kết quả |
|---|---|
| Số request đã gửi | ____ |
| CPU time p50 của ingest | ____ ms |
| CPU time p99 của ingest | ____ ms |
| Lỗi 1102 (vượt CPU) | ____ |

## 3. Băm mật khẩu PBKDF2-SHA256 (P1-23)

Cách đo: `curl.exe "https://<worker>.workers.dev/api/_spike/hash?iter=N"`, mỗi mức 10 lần. workerd giới hạn tối đa 100.000 vòng lặp.

| Số vòng | Thành công/10 | Lỗi 1102 | CPU ghi nhận |
|---|---|---|---|
| 10.000 | ____ | ____ | ____ |
| 50.000 | ____ | ____ | ____ |
| 100.000 | ____ | ____ | ____ |

## 4. Static assets (P1-24)

Cách đo: deploy bằng `pnpm deploy:web`; tải trang và các tệp tĩnh khoảng 20 lần; so với số request của Worker `az-sentinel-web` trong dashboard.

Lưu ý: trên `workers.dev` Worker web và Worker API ở hai địa chỉ khác nhau, nên trang đã deploy sẽ hiện trạng thái lỗi "Không gọi được API" (`/api/health` không cùng origin). Điều này bình thường ở Part 1; chỉ dùng trang để đo static assets. Cùng origin chỉ có khi có domain riêng (Part 4).

| Chỉ số | Kết quả |
|---|---|
| Số lần tải trang/tệp tĩnh đã thực hiện | ____ |
| Số request ghi nhận của Worker web | ____ |
| Kết luận (assets có bị tính request không) | ____ |

## 5. Đối chiếu dự báo với dashboard D1 (P1-25)

| Chỉ số | Dự báo (Plan 2 mục 9) | Thực tế (dashboard) | Lệch |
|---|---|---|---|
| Dòng ghi theo số request đã gửi | ____ | ____ | ____ % |
| Dòng đọc theo số request đã gửi | ____ | ____ | ____ % |

## 6. Thử MT5 (P1-27 đến P1-29)

| Mục | Kết quả |
|---|---|
| P1-27 Mã HTTP từ MT5 demo tới `workers.dev` | ____ |
| P1-27 `link_state` được cập nhật ở D1 remote (lệnh truy vấn) | ____ |
| P1-28 `GetLastError()` thực tế khi URL chưa được cho phép (Plan 1 giả định 4014) | ____ |
| P1-29 (tùy chọn) MT5 gọi được `http://127.0.0.1:8787` | ____ |

## 7. Quyết định cuối Part 1 (P1-32)

Điền sau khi có đủ số đo. Ngưỡng lấy từ Plan 3 mục 6.

| Câu hỏi | Ngưỡng đạt | Kết quả đo | Quyết định |
|---|---|---|---|
| Số dòng ghi mỗi ingest | heartbeat ≤ 1, m5_bar ≤ 2 | local: 1 và 2 (remote: ____) | ____ |
| CPU ingest trên Cloudflare | p99 dưới 8 ms | ____ | ____ |
| Băm mật khẩu | Không lỗi 1102 ở số vòng chấp nhận được | ____ | ____ |
| Static assets | Không tính vào request của Worker web | ____ | ____ |
| MT5 gọi API | Mã 200 từ demo | ____ | ____ |
| Dự báo vs thực tế | Lệch dưới 30% | ____ | ____ |

Quyết định ghi lại: ____
