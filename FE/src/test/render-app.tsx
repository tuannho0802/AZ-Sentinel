import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { StrictMode } from 'react'
import { vi } from 'vitest'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { App } from '../App'
import { wireAuth } from '../features/auth/api'
import { clearLive } from '../features/links/live/live-store'
import { resetServerStatus } from '../lib/server-status'
import { installFakeWebSocket } from './fake-websocket'

type Handler = () => Response | Promise<Response>

export const json = (status: number, body: unknown) => Response.json(body, { status })
/** Thông tin máy chủ mặc định (chỉ Cloudflare) để test không phải khai báo `/api/server-info`. */
const defaultServerInfo = {
  mode: 'standalone',
  active: {
    role: 'cloudflare',
    name: 'Cloudflare',
    host: null,
    os: null,
    arch: null,
    runtime: 'cloudflare-workers',
    version: '0.1.0',
    startedAt: 1,
    uptimeSec: 1,
    cpuCount: null,
    memTotalMb: null,
    memFreeMb: null,
    cpuPct: null,
    location: null,
  },
  primary: { configured: false, status: 'unknown', lastSeenAt: null, info: null },
  standby: null,
  gateways: 0,
  viewers: 0,
  checkedAt: 1,
}

export const me = { id: 1, email: 'a@az.local', display_name: 'Tuan', role: 'admin' }

/** Giả lập fetch theo khóa "METHOD /đường-dẫn"; gọi API chưa khai báo sẽ làm test lỗi. */
export function renderApp(
  path: string,
  handlers: Record<string, Handler>,
  opts: { strict?: boolean } = {},
) {
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${input}`
    const handler =
      handlers[key] ??
      (key === 'GET /api/server-info' ? () => json(200, defaultServerInfo) : undefined) ??
      (input.startsWith('/api/notifications') && !init?.method
        ? () => json(200, { items: [], unread: 0 })
        : undefined)
    if (!handler) throw new Error(`Chưa giả lập ${init?.method ?? 'GET'} ${input}`)
    return handler()
  })
  vi.stubGlobal('fetch', fetchMock)
  installFakeWebSocket()
  clearLive()
  resetServerStatus()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  wireAuth(client)
  const { hook } = memoryLocation({ path })
  const tree = (
    <QueryClientProvider client={client}>
      <Router hook={hook}>
        <App />
      </Router>
    </QueryClientProvider>
  )
  const { unmount } = render(opts.strict ? <StrictMode>{tree}</StrictMode> : tree)
  return { fetchMock, unmount, client }
}
