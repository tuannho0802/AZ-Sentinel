import { useServerStatus } from '../../lib/server-status'
import { strings } from '../../lib/strings'
import { useServerInfo } from './api'

/**
 * Huy hiệu trên thanh đầu: máy chủ nào đang phục vụ. Hình khác nhau cho từng trạng thái (chấm đặc, vòng
 * rỗng, ô vuông) nên không chỉ dựa vào màu. Lấy từ header của mọi lời gọi API nên có ngay cả khi
 * `/api/server-info` chưa gọi được (chưa đăng nhập).
 */
export function ServerBadge() {
  const status = useServerStatus()
  const info = useServerInfo()
  const name = info.data?.active.name

  let box = 'bg-raised text-muted'
  let mark = <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-subtle" />
  let label: string = strings.serverBadgeUnknown

  if (status.unreachable) {
    box = 'bg-loss-bg text-loss'
    mark = <span aria-hidden="true" className="inline-block h-2 w-2 bg-loss" />
    label = strings.serverBadgeUnreachable
  } else if (status.servedBy === 'vps') {
    box = 'bg-gain-bg text-gain'
    mark = <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-gain" />
    label = name ? `${strings.serverBadgeVps} · ${name}` : strings.serverBadgeVps
  } else if (status.servedBy === 'cloudflare') {
    const fallback = status.mode === 'fallback'
    box = fallback ? 'bg-notice-bg text-notice-ink' : 'bg-live-bg text-live'
    mark = (
      <span
        aria-hidden="true"
        className={`inline-block h-2 w-2 rounded-full border-2 ${fallback ? 'border-notice-ink' : 'border-live'}`}
      />
    )
    label = fallback
      ? `${strings.serverBadgeCloudflare} · ${strings.serverBadgeFallback}`
      : strings.serverBadgeCloudflare
  }

  return (
    <span
      title={`${strings.serverBadgeLabel}: ${label}`}
      className={`inline-flex max-w-52 items-center gap-1.5 truncate rounded-full px-2.5 py-1 text-xs font-medium max-sm:px-2 ${box}`}
    >
      {mark}
      <span className="truncate max-sm:sr-only">{label}</span>
    </span>
  )
}
