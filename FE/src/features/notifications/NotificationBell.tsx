import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { strings } from '../../lib/strings'
import { useNotifications } from './api'
import { NotificationPanel } from './NotificationPanel'

/**
 * Chuông thông báo ở thanh đầu: số chưa đọc trên huy hiệu, bấm mở bảng danh sách. Đóng bằng Esc hoặc bấm ra ngoài.
 * Dữ liệu chỉ là thông báo của chính người đăng nhập (BE lọc theo chủ sở hữu).
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const query = useNotifications()
  const unread = query.data?.unread ?? 0

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open])

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-label={strings.notifBellLabel(unread)}
        aria-expanded={open}
        aria-controls="notif-panel"
        onClick={() => setOpen((v) => !v)}
        className="relative inline-flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-raised hover:text-ink"
      >
        <Icon name="bell" size={18} />
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-loss px-1 text-center text-[0.625rem] leading-4 font-semibold text-white"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && <NotificationPanel query={query} onClose={() => setOpen(false)} />}
    </div>
  )
}
