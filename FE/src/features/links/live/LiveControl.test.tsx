import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { strings } from '../../../lib/strings'
import { LiveBanners, LiveControl } from './LiveControl'
import type { LiveStatus } from './useLiveLease'

afterEach(cleanup)

const noop = () => {}
const control = (status: LiveStatus, anyLive = false, onPause = noop, onResume = noop) =>
  render(
    <LiveControl
      status={status}
      anyLive={anyLive}
      kick={null}
      onPause={onPause}
      onResume={onResume}
      onRetry={noop}
    />,
  )

describe('LiveControl', () => {
  it.each<[LiveStatus, boolean, string]>([
    ['open', true, strings.liveRunning],
    ['open', false, strings.liveWaking],
    ['connecting', false, strings.liveConnecting],
    ['paused', false, strings.livePaused],
    ['idle_paused', false, strings.livePaused],
    ['disconnected', false, strings.liveDisconnected],
    ['kicked', false, strings.liveKicked],
  ])('trạng thái %s (có live: %s) hiện "%s" trong vùng aria-live', (status, anyLive, text) => {
    control(status, anyLive)
    const region = screen.getByRole('status')
    expect(region.getAttribute('aria-live')).toBe('polite')
    expect(region.textContent).toBe(text)
  })

  it('đang chạy: nút Tạm dừng, aria-pressed=true, bấm gọi onPause', () => {
    const onPause = vi.fn()
    control('open', true, onPause)
    const btn = screen.getByRole('button', { name: strings.livePauseButton })
    expect(btn.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(btn)
    expect(onPause).toHaveBeenCalledTimes(1)
  })

  it.each<LiveStatus>(['paused', 'idle_paused', 'kicked'])(
    '%s: nút Tiếp tục, aria-pressed=false, bấm gọi onResume',
    (status) => {
      const onResume = vi.fn()
      control(status, false, noop, onResume)
      const btn = screen.getByRole('button', { name: strings.liveResumeButton })
      expect(btn.getAttribute('aria-pressed')).toBe('false')
      fireEvent.click(btn)
      expect(onResume).toHaveBeenCalledTimes(1)
    },
  )
})

describe('LiveBanners', () => {
  it('không hiện gì khi bình thường', () => {
    render(<LiveBanners status="open" kick={null} onRetry={noop} />)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('tạm dừng do không thao tác', () => {
    render(<LiveBanners status="idle_paused" kick={null} onRetry={noop} />)
    expect(screen.getByRole('alert').textContent).toContain(strings.liveIdleBanner)
  })

  it('bị ngắt do quá nhiều tab, và do hết phiên', () => {
    const { rerender } = render(<LiveBanners status="kicked" kick="too_many_tabs" onRetry={noop} />)
    expect(screen.getByRole('alert').textContent).toContain(strings.liveKickTabs)
    rerender(<LiveBanners status="kicked" kick="session_expired" onRetry={noop} />)
    expect(screen.getByRole('alert').textContent).toContain(strings.liveKickSession)
  })

  it('mất kết nối: có nút Thử lại gọi onRetry', () => {
    const onRetry = vi.fn()
    render(<LiveBanners status="disconnected" kick={null} onRetry={onRetry} />)
    expect(screen.getByRole('alert').textContent).toContain(strings.liveLostText)
    fireEvent.click(screen.getByRole('button', { name: strings.retry }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
