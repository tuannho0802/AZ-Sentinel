import { primaryTarget, readFallbackUrl, useFailoverState } from '../../lib/failover'
import { useServerStatus } from '../../lib/server-status'
import { strings } from '../../lib/strings'
import { useServerInfo } from './api'

const linkClass = 'mt-1 inline-block font-medium underline underline-offset-2'

/**
 * Banner khi hệ thống không chạy ở VPS chính.
 * - Đang ở Cloudflare dự phòng (VPS sập): báo cho người dùng biết; VPS lên lại (kể cả tunnel mới) thì hiện nút
 *   mở thẳng địa chỉ mới, giữ nguyên trang đang xem.
 * - Không gọi được máy chủ nào (trang đang mở từ VPS mà VPS vừa sập): đếm ngược rồi tự chuyển sang bản dự phòng
 *   (việc chuyển do `FailoverWatcher` làm); vẫn có nút mở tay.
 */
export function FailoverBanner() {
  const status = useServerStatus()
  const info = useServerInfo()
  const failover = useFailoverState()

  if (status.unreachable) {
    const fallbackUrl = info.data?.fallbackUrl ?? readFallbackUrl()
    return (
      <div role="alert" className="mb-4 rounded-md bg-loss-bg px-4 py-3 text-sm text-loss">
        <p className="font-semibold">{strings.lostBannerTitle}</p>
        <p>{strings.lostBannerText}</p>
        {failover.redirectInSec !== null && <p>{strings.lostAutoSwitch(failover.redirectInSec)}</p>}
        {failover.fallbackDown && <p>{strings.lostFallbackDown}</p>}
        {!fallbackUrl && <p>{strings.lostNoFallback}</p>}
        {fallbackUrl && (
          <a className={linkClass} href={fallbackUrl}>
            {strings.lostOpenFallback}
          </a>
        )}
      </div>
    )
  }

  if (status.servedBy === 'cloudflare' && status.mode === 'fallback') {
    const primaryUp = info.data?.primary.status === 'up'
    const href = primaryUp ? primaryTarget(info.data?.primaryUrl, window.location) : null
    return (
      <div role="status" className="mb-4 rounded-md bg-notice-bg px-4 py-3 text-sm text-notice-ink">
        <p className="font-semibold">{strings.failoverBannerTitle}</p>
        <p>{strings.failoverBannerText}</p>
        {href && (
          <a className={linkClass} href={href}>
            {strings.failoverBackToPrimary}
          </a>
        )}
      </div>
    )
  }

  return null
}
