import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { strings } from '../../lib/strings'
import type { Health } from './links-view'
import { StatusBadge } from './StatusBadge'

afterEach(cleanup)

const cases: [Health, boolean, string][] = [
  ['live', true, strings.badgeLive],
  ['waking', true, strings.badgeWaking],
  ['silent', true, strings.badgeIdle],
  ['online', true, strings.online],
  ['offline', true, strings.offline],
  ['awaiting', false, strings.awaitingEa],
  ['awaiting', true, strings.noData],
  ['disabled', true, strings.statusDisabled],
]

describe('StatusBadge', () => {
  it.each(cases)('%s (có tài khoản: %s) hiện chữ "%s"', (health, hasAccount, label) => {
    render(<StatusBadge health={health} hasAccount={hasAccount} />)
    expect(screen.getByText(label)).toBeTruthy()
  })

  it('mỗi tình trạng có chữ khác nhau (không chỉ dựa vào màu)', () => {
    const labels = new Set(cases.filter(([h, a]) => !(h === 'awaiting' && a)).map((c) => c[2]))
    expect(labels.size).toBe(cases.length - 1)
  })

  it('biểu tượng trang trí đều aria-hidden', () => {
    const { container } = render(<StatusBadge health="silent" hasAccount />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
  })

  it('live có chấm nhấp nháy, waking có vòng rỗng', () => {
    const live = render(<StatusBadge health="live" hasAccount />)
    expect(live.container.querySelector('.az-pulse')).not.toBeNull()
    cleanup()
    const waking = render(<StatusBadge health="waking" hasAccount />)
    expect(waking.container.querySelector('.az-ring')).not.toBeNull()
  })
})
