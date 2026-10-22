import { useServerStatus } from '../../lib/server-status'
import { strings } from '../../lib/strings'
import { useServerInfo } from './api'

const linkClass = 'mt-1 inline-block font-medium underline underline-offset-2'

/**
 * Banner khi hệ thống không chạy ở VPS chính.
 * - Đang ở Cloudflare dự phòng (VPS sập): báo cho người dùng biết và, nếu biết URL VPS, gợi ý quay về.
 * - Không gọi được máy chủ nào (trang đang mở từ VPS mà VPS vừa sập): gợi ý mở bản dự phòng.
 */
export function FailoverBanner() {
  const status = useServerStatus()
  const info = useServerInfo()

  if (status.unreachable) {
    const fallbackUrl = info.data?.fallbackUrl
    return (
      <div role="alert" className="mb-4 rounded-md bg-loss-bg px-4 py-3 text-sm text-loss">
        <p className="font-semibold">{strings.lostBannerTitle}</p>
        <p>{strings.lostBannerText}</p>
        {fallbackUrl && (
          <a className={linkClass} href={fallbackUrl}>
            {strings.lostOpenFallback}
          </a>
        )}
      </div>
    )
  }

  if (status.servedBy === 'cloudflare' && status.mode === 'fallback') {
    const primaryUrl = info.data?.primaryUrl
    const primaryUp = info.data?.primary.status === 'up'
    return (
      <div role="status" className="mb-4 rounded-md bg-notice-bg px-4 py-3 text-sm text-notice-ink">
        <p className="font-semibold">{strings.failoverBannerTitle}</p>
        <p>{strings.failoverBannerText}</p>
        {primaryUrl && primaryUp && (
          <a className={linkClass} href={primaryUrl}>
            {strings.failoverBackToPrimary}
          </a>
        )}
      </div>
    )
  }

  return null
}
