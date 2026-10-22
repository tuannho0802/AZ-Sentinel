// Chạy Server (VPS giả lập) cho môi trường dev (`pnpm dev` ở gốc repo): build rồi chạy với cấu hình
// mặc định để nối với BE local (Cloudflare giả lập, cổng 8787). Biến AZ_* đặt sẵn vẫn được ưu tiên.
// Dữ liệu SQLite nằm ở Server/.dev-data (đã .gitignore); xóa thư mục này để làm lại từ đầu.
import { fileURLToPath } from 'node:url'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const defaults = {
  AZ_DATA: here('./.dev-data'),
  AZ_PORT: '8080',
  AZ_HOST: '127.0.0.1',
  AZ_SRV_NAME: 'VPS-LOCAL',
  AZ_SRV_LOCATION: 'May dev',
  AZ_GW_CONNECT_TOKEN: 'dev-gw-token-0123456789abcdef',
  AZ_SYNC_TOKEN: 'dev-sync-token-0123456789abcdef',
  AZ_CLOUD_URL: 'http://127.0.0.1:8787',
  AZ_FALLBACK_URL: 'http://127.0.0.1:8787',
  AZ_LIVE_ALLOWED_ORIGINS: 'http://localhost:5173,http://127.0.0.1:5173',
  AZ_DEV_LINKS_API: '1',
  AZ_LOG: 'debug',
}
for (const [k, v] of Object.entries(defaults)) process.env[k] ??= v

await import('./build.mjs')
await import('./dist/server.mjs')
