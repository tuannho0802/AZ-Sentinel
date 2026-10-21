export {}

/**
 * Chạy Gateway cho môi trường dev (`pnpm dev` ở gốc repo): mặc định nối tới BE local cổng 8787.
 * Biến AZ_GW_CLOUD_URL đặt sẵn vẫn được ưu tiên. BE chưa lên kịp thì Gateway tự nối lại.
 */
process.env.AZ_GW_CLOUD_URL ??= 'ws://127.0.0.1:8787/api/gw/ws'
await import('../src/main')
