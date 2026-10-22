# Plan 3E: VPS là máy chủ chính, Cloudflare chỉ dự phòng

## 1. Kiến trúc

```
Trình duyệt / Gateway / EA
        │
        ├── (đường chính) ──► VPS: Server (Node) = BE Hono + LiveHub + SQLite + giao diện FE/dist
        │                          │  đẩy thay đổi (outbox) + nhịp sống  ► Cloudflare Worker (/api/sync/*)
        │                          │  kéo lệnh Cloudflare đã ghi hộ     ◄
        │
        └── (đường dự phòng, khi VPS sập) ──► Cloudflare Worker + D1 + Durable Object + assets
```

- `Server/` chạy NGUYÊN mã BE và `LiveHub` trên Node (shim `cloudflare:workers`, SQLite thay D1) và phục vụ luôn FE (`FE/dist`), nên truy cập bình thường không tốn request Cloudflare.
- Cloudflare vẫn có dữ liệu gần nhất nhờ đồng bộ liên tục; VPS sập thì người dùng mở bản dự phòng, VPS sống lại thì dữ liệu Cloudflare đã ghi hộ được kéo về VPS.
- Gateway nối vào VPS (`cloudUrl`); nếu hai lần liền không nối được thì chuyển sang `cloudFallbackUrl` (Worker) và cứ 60 giây thử quay về VPS.

## 2. Máy khác truy cập VPS bằng cách nào (chọn một)

| Cách | Khi nào dùng | Ghi chú |
|---|---|---|
| **Cloudflare Tunnel** (`cloudflared`) | Khuyến nghị: VPS không mở cổng, có HTTPS/WSS sẵn, tên miền riêng | Miễn phí; chạy như dịch vụ Windows. Trỏ hostname → `http://127.0.0.1:8080`. Server chỉ tin `CF-Connecting-IP` khi kết nối tới từ loopback |
| Reverse proxy (Caddy/nginx) + IP công khai | VPS có IP tĩnh và tên miền | Tự lấy chứng chỉ; proxy về `127.0.0.1:8080`, nhớ chuyển tiếp WebSocket và đặt `CF-Connecting-IP` |
| Tailscale / VPN | Chỉ nhóm nội bộ | Đặt `AZ_HOST=0.0.0.0` hoặc IP Tailscale; không cần tên miền |
| LAN trực tiếp | Cùng mạng | `AZ_HOST=0.0.0.0`, mở `http://<ip-vps>:8080` (không HTTPS) |

Lưu ý: nếu người dùng vào bằng hostname của Worker (không phải hostname VPS) thì Worker chuyển tiếp `/api/*` sang VPS và vẫn tính request Cloudflare. Để tiết kiệm, hãy dùng URL của VPS làm địa chỉ chính và chỉ phát URL Worker như dự phòng.

## 3. Triển khai

1. Máy dev: `pnpm install`, `pnpm pack:server` (build FE rồi đóng gói `Server/release/az-server`).
2. Chép thư mục đó lên VPS (cần Node 22.5+ hoặc chép `node.exe` cạnh `server.mjs`). Copy `server.env.example` → `server.env`, điền cấu hình.
3. PowerShell (Administrator): `.\install-task.ps1 -AppDir C:\AZServer`. Log: `%ProgramData%\AZSentinelServer\logs\server.log`.
4. Cài `cloudflared`, tạo tunnel trỏ hostname → `http://127.0.0.1:8080`.
5. Cloudflare Worker: `wrangler secret put SYNC_TOKEN` (cùng giá trị `AZ_SYNC_TOKEN`), đặt biến `VPS_ORIGIN` = URL VPS (hostname tunnel), `PRIMARY_URL`, `FALLBACK_URL`; deploy lại `pnpm deploy:api` và `pnpm deploy:web`.
6. Gateway: `cloudUrl` = `wss://<vps>/api/gw/ws`, `cloudFallbackUrl` = `wss://<worker>/api/gw/ws` (cũng sửa được trong giao diện Gateway).

## 4. Hành vi khi VPS sập / sống lại

- Worker dò VPS; không đáp thì chuyển `fallback`: `GET` phục vụ từ D1, ghi `/api/dev/*` bị chặn (`READ_ONLY_FALLBACK`) trừ khi đặt `FALLBACK_WRITABLE=1`.
- Ghi dữ liệu thật của EA vẫn nhận ở Cloudflare; khi VPS sống lại, `SyncAgent` kéo các lệnh đó về (không ghi đè lệnh VPS đã đóng) rồi đẩy phần VPS có mà Cloudflare chưa có.
- FE: huy hiệu máy chủ ở thanh đầu, banner khi dự phòng hoặc mất kết nối, thẻ "Máy chủ" trên Dashboard.

## 5. Còn lại / chưa kiểm chứng

- Chưa chạy test hay chạy thử thật (theo yêu cầu): cần thử bắt tay WebSocket Gateway → VPS, failover và kéo dữ liệu về trên máy thật.
- Test FE/BE/Server mới chưa có cho phần shim WebSocket, `static.ts`, `http.ts` và failover Gateway.
