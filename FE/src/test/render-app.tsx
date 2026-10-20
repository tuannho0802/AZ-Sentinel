import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { StrictMode } from 'react'
import { vi } from 'vitest'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { App } from '../App'
import { wireAuth } from '../features/auth/api'
import { clearLive } from '../features/links/live/live-store'
import { installFakeWebSocket } from './fake-websocket'

type Handler = () => Response | Promise<Response>

export const json = (status: number, body: unknown) => Response.json(body, { status })
export const me = { id: 1, email: 'a@az.local', display_name: 'Tuan', role: 'admin' }

/** Giả lập fetch theo khóa "METHOD /đường-dẫn"; gọi API chưa khai báo sẽ làm test lỗi. */
export function renderApp(
  path: string,
  handlers: Record<string, Handler>,
  opts: { strict?: boolean } = {},
) {
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const handler = handlers[`${init?.method ?? 'GET'} ${input}`]
    if (!handler) throw new Error(`Chưa giả lập ${init?.method ?? 'GET'} ${input}`)
    return handler()
  })
  vi.stubGlobal('fetch', fetchMock)
  installFakeWebSocket()
  clearLive()
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
