import type { ReactNode } from 'react'
import { Icon } from '../../components/Icon'
import { strings } from '../../lib/strings'
import type { Health } from './links-view'

/**
 * Một huy hiệu cho một tình trạng. Mỗi tình trạng khác nhau cả về HÌNH (chấm đặc, vòng rỗng,
 * ô vuông, cảnh báo) lẫn chữ lẫn màu, nên không chỉ dựa vào màu (Rules FE mục 9).
 */
const dot = 'inline-block h-2 w-2 shrink-0 rounded-full'

type Look = { box: string; mark: ReactNode; label: string }

function look(health: Health, hasAccount: boolean): Look {
  switch (health) {
    case 'live':
      return {
        box: 'bg-live-bg text-live',
        mark: <span aria-hidden="true" className={`${dot} az-pulse bg-live`} />,
        label: strings.badgeLive,
      }
    case 'waking':
      return {
        box: 'bg-raised text-muted',
        mark: <span aria-hidden="true" className={`${dot} az-ring border-2 border-live`} />,
        label: strings.badgeWaking,
      }
    case 'silent':
      return {
        box: 'bg-notice-bg text-notice-ink',
        mark: <Icon name="alert" size={12} />,
        label: strings.badgeIdle,
      }
    case 'online':
      return {
        box: 'bg-gain-bg text-gain',
        mark: <span aria-hidden="true" className={`${dot} bg-gain`} />,
        label: strings.online,
      }
    case 'offline':
      return {
        box: 'bg-loss-bg text-loss',
        mark: (
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 shrink-0 rounded-[2px] bg-loss"
          />
        ),
        label: strings.offline,
      }
    case 'awaiting':
      return {
        box: 'bg-raised text-muted',
        mark: <span aria-hidden="true" className={`${dot} border-2 border-dashed border-subtle`} />,
        label: hasAccount ? strings.noData : strings.awaitingEa,
      }
    case 'disabled':
      return {
        box: 'bg-raised text-muted',
        mark: <span aria-hidden="true" className="inline-block h-0.5 w-2.5 shrink-0 bg-subtle" />,
        label: strings.statusDisabled,
      }
  }
}

/** Chữ của huy hiệu (để chỗ không vẽ huy hiệu vẫn đọc được tình trạng, ví dụ thẻ gọn trên điện thoại). */
export function healthLabel(health: Health, hasAccount: boolean): string {
  return look(health, hasAccount).label
}

export function StatusBadge({ health, hasAccount }: { health: Health; hasAccount: boolean }) {
  const l = look(health, hasAccount)
  return (
    <span
      className={`inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap ${l.box}`}
    >
      {l.mark}
      <span>{l.label}</span>
    </span>
  )
}
