import { useState } from 'react'
import { Button } from '../../components/Button'
import { Dialog } from '../../components/Dialog'
import { readFallbackUrl } from '../../lib/failover'
import {
  hasManifest,
  installPageUrl,
  isIos,
  isStandalone,
  promptInstall,
  useInstallPrompt,
} from '../../lib/pwa'
import { strings } from '../../lib/strings'

const DISMISS_KEY = 'az.installDismissed'

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

function writeDismissed(): void {
  try {
    localStorage.setItem(DISMISS_KEY, '1')
  } catch {
    // trình duyệt chặn lưu trữ: banner chỉ ẩn trong lần xem này
  }
}

/**
 * Mời cài giao diện thành ứng dụng. Ba tình huống:
 * - Đã ở trong ứng dụng cài rồi: không hiện.
 * - Trang do Worker phục vụ (có thẻ manifest) và trình duyệt cho phép cài: nút "Cài ứng dụng" mở hộp thoại cài.
 *   Safari iOS không có hộp thoại đó nên hiện hướng dẫn "Thêm vào Màn hình chính".
 * - Trang do VPS/tunnel phục vụ (không cài được ở đây): nút mở địa chỉ Worker ở chế độ "ở lại" để cài từ đó.
 * "Để sau" ẩn hẳn trên thiết bị này (cài xong thì banner cũng tự biến mất vì đã ở chế độ ứng dụng).
 */
export function InstallBanner() {
  const prompt = useInstallPrompt()
  const [dismissed, setDismissed] = useState(readDismissed)
  const [iosHelp, setIosHelp] = useState(false)

  if (dismissed || isStandalone()) return null

  const onWorker = hasManifest()
  const workerUrl = onWorker ? null : installPageUrl(readFallbackUrl(), window.location.origin)
  const ios = onWorker && !prompt && isIos()
  if (!prompt && !ios && !workerUrl) return null

  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md bg-notice-bg px-4 py-3 text-sm text-notice-ink"
    >
      <div>
        <p className="font-semibold">{strings.installTitle}</p>
        <p>{strings.installText}</p>
      </div>
      <div className="flex items-center gap-3">
        {prompt && (
          <Button size="sm" variant="primary" onClick={() => void promptInstall()}>
            {strings.installBtn}
          </Button>
        )}
        {ios && (
          <Button size="sm" variant="primary" onClick={() => setIosHelp(true)}>
            {strings.installBtn}
          </Button>
        )}
        {workerUrl && (
          <a
            className="inline-flex h-7 items-center rounded-md bg-accent px-2.5 text-[0.8125rem] font-medium text-accent-ink hover:brightness-105"
            href={workerUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {strings.installOpenWorker}
          </a>
        )}
        <button
          type="button"
          className="font-medium underline underline-offset-2"
          onClick={() => {
            writeDismissed()
            setDismissed(true)
          }}
        >
          {strings.installLater}
        </button>
      </div>
      {iosHelp && (
        <Dialog
          title={strings.installIosTitle}
          onClose={() => setIosHelp(false)}
          footer={<Button onClick={() => setIosHelp(false)}>{strings.close}</Button>}
        >
          <p className="text-sm">{strings.installIosSteps}</p>
          <p className="mt-2 text-sm text-muted">{strings.installIosNote}</p>
        </Dialog>
      )}
    </div>
  )
}
