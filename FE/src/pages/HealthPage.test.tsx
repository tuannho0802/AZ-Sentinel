import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { strings } from '../lib/strings'
import { HealthPage } from './HealthPage'

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <HealthPage />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('HealthPage', () => {
  it('hiện "API OK" khi /api/health trả 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ status: 'ok' })))
    renderPage()
    expect(screen.getByText(strings.apiLoading)).toBeTruthy()
    expect(await screen.findByText(strings.apiOk)).toBeTruthy()
  })

  it('hiện lỗi và nút thử lại khi API lỗi', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: { code: 'INTERNAL', message: 'Lỗi hệ thống' } }, { status: 500 }),
        ),
    )
    renderPage()
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('button', { name: strings.retry })).toBeTruthy()
  })
})
