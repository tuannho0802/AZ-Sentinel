import { useState } from 'react'
import { strings } from '../../lib/strings'
import { useMe } from '../auth/api'
import { useServerInfo } from './api'

const DISMISS_KEY = 'az.updateDismissed'
/** Chỉ nhận liên kết về github.com (dữ liệu đến từ API, không đưa thẳng vào `href` nếu lạ). */
const GITHUB_URL = /^https:\/\/github\.com\//

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY)
  } catch {
    return null
  }
}

function writeDismissed(version: string): void {
  try {
    localStorage.setItem(DISMISS_KEY, version)
  } catch {
    // trình duyệt chặn lưu trữ: banner chỉ ẩn trong lần xem này
  }
}

/**
 * Banner "có bản AZ Server mới" cho quản trị viên. Dữ liệu `update` chỉ có khi giao diện do chính VPS phục vụ (bộ cài
 * Server tự hỏi GitHub Releases); giao diện qua Worker/Cloudflare không có nên không hiện. "Để sau" chỉ ẩn đúng phiên
 * bản đó, có bản mới hơn thì hiện lại.
 */
export function UpdateBanner() {
  const me = useMe()
  const info = useServerInfo()
  const [dismissed, setDismissed] = useState(readDismissed)

  const isAdmin = me.data?.role === 'admin' || me.data?.role === 'root_admin'
  const update = info.data?.update?.server
  if (!isAdmin || !update?.available || dismissed === update.latest) return null

  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-1 rounded-md bg-notice-bg px-4 py-3 text-sm text-notice-ink"
    >
      <div>
        <p className="font-semibold">{strings.updateBannerTitle(update.latest)}</p>
        <p>{strings.updateBannerText}</p>
        {GITHUB_URL.test(update.url) && (
          <a
            className="mt-1 inline-block font-medium underline underline-offset-2"
            href={update.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {strings.updateBannerGet}
          </a>
        )}
      </div>
      <button
        type="button"
        className="font-medium underline underline-offset-2"
        onClick={() => {
          writeDismissed(update.latest)
          setDismissed(update.latest)
        }}
      >
        {strings.updateBannerLater}
      </button>
    </div>
  )
}
