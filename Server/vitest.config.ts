import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const here = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  // Giống build.mjs: `cloudflare:workers` (chỉ Worker mới có) được thay bằng shim của Server, để test chạy nguyên LiveHub trên Node.
  resolve: {
    alias: {
      'cloudflare:workers': path.join(here, 'src/shim/cloudflare-workers.ts'),
    },
  },
  test: { include: ['test/**/*.test.ts'] },
})
