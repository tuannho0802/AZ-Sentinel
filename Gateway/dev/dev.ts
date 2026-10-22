export {}

/**
 * Chạy Gateway cho môi trường dev (`pnpm dev` ở gốc repo): nối VPS giả lập (Server, cổng 8080) làm chính,
 * BE Worker local (8787) làm dự phòng. Biến AZ_GW_* đặt sẵn vẫn được ưu tiên. Server/BE chưa lên kịp thì
 * Gateway tự nối lại.
 */
process.env.AZ_GW_CLOUD_URL ??= 'ws://127.0.0.1:8080/api/gw/ws'
process.env.AZ_GW_CLOUD_FALLBACK_URL ??= 'ws://127.0.0.1:8787/api/gw/ws'
process.env.AZ_GW_TOKEN ??= 'dev-gw-token-0123456789abcdef'
await import('../src/main')
