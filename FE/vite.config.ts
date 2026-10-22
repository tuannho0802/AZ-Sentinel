import process from 'node:process'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { createLogger } from 'vite'
import { defineConfig } from 'vitest/config'
import { mockAuth } from './dev-mock-auth'

// Giả lập đăng nhập chỉ chạy ở dev server (plugin có apply: 'serve'); tắt bằng AZ_MOCK_AUTH=0.
const useMockAuth = process.env.AZ_MOCK_AUTH !== '0'

// Đóng tab, chuyển /links <-> /links/:id, hoặc workerd đóng WebSocket đột ngột đều làm proxy dev
// của Vite nhận ECONNRESET/EPIPE. Đó là chuyện bình thường của live, không phải lỗi: bỏ riêng hai
// dòng log này cho đỡ nhiễu. Mọi lỗi proxy khác (ví dụ BE chưa chạy) vẫn được in ra.
const logger = createLogger()
const logError = logger.error
logger.error = (msg, options) => {
  const isWsProxy = msg.includes('ws proxy error') || msg.includes('ws proxy socket error')
  if (isWsProxy && (msg.includes('ECONNRESET') || msg.includes('EPIPE'))) return
  logError(msg, options)
}

const apiTarget = process.env.AZ_API_TARGET ?? 'http://127.0.0.1:8080'

export default defineConfig({
  customLogger: logger,
  plugins: [react(), tailwindcss(), ...(useMockAuth ? [mockAuth()] : [])],
  // Mặc định đi qua Server (VPS giả lập, 8080); đặt AZ_API_TARGET=http://127.0.0.1:8787 để dùng thẳng BE Worker.
  server: { port: 5173, proxy: { '/api': { target: apiTarget, ws: true } } },
  test: { environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'] },
})
