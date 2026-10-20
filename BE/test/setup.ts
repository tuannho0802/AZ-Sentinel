import { applyD1Migrations } from 'cloudflare:test'
import { env } from 'cloudflare:workers'

// Áp toàn bộ migration trong migrations/ lên D1 test (idempotent). Đồng thời kiểm tra
// migration chạy được từ DB trống (Rules BE mục 12).
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
