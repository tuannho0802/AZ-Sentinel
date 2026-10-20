import process from 'node:process'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { mockAuth } from './dev-mock-auth'

// Giả lập đăng nhập chỉ chạy ở dev server (plugin có apply: 'serve'); tắt bằng AZ_MOCK_AUTH=0.
const useMockAuth = process.env.AZ_MOCK_AUTH !== '0'

export default defineConfig({
  plugins: [react(), tailwindcss(), ...(useMockAuth ? [mockAuth()] : [])],
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:8787' } },
  test: { environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'] },
})
