import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Giống build.mjs: `cloudflare:workers` (chỉ Worker mới có) được thay bằng shim của Server, để test chạy nguyên LiveHub trên Node.
  resolve: {
    alias: {
      'cloudflare:workers': fileURLToPath(
        new URL('./src/shim/cloudflare-workers.ts', import.meta.url),
      ),
    },
  },
  test: { include: ['test/**/*.test.ts'] },
})
