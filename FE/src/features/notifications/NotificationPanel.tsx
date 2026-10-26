import type { NotificationListResponse, NotificationView } from '@az-sentinel/shared'
import type { UseQueryResult } from '@tanstack/react-query'
import { useState } from 'react'
import { useLocation } from 'wouter'
import { Button } from '../../components/Button'
import { formatDateTime, formatRelative } from '../../lib/format'
import { strings } from '../../lib/strings'
import { AlertSettingsForm } from './AlertSettingsForm'
import { useMarkRead } from './api'

const KIND_MARK: Record<NotificationView['kind'], string> = {
  warn: 'bg-loss',
  increase: 'bg-loss',
  clear: 'bg-subtle',
}

function Item({ n, onOpen }: { n: NotificationView; onOpen: (n: NotificationView) => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(n)}
        className={`flex w-full gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-raised ${
          n.read ? '' : 'bg-live-bg'
        }`}
      >
        <span
          aria-hidden="true"
          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? 'bg-transparent' : KIND_MARK[n.kind]}`}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className={`truncate text-sm text-ink ${n.read ? '' : 'font-semibold'}`}>
              {n.title}
            </span>
            {!n.read && <span className="sr-only">{strings.notifUnread}</span>}
            <time
              dateTime={new Date(n.created_at * 1000).toISOString()}
              title={formatDateTime(n.created_at)}
              className="shrink-0 text-xs text-muted"
            >
              {formatRelative(n.created_at)}
            </time>
          </span>
          <span className="mt-0.5 block text-[0.8125rem] leading-snug break-words text-muted">
            {n.body}
          </span>
        </span>
      </button>
    </li>
  )
}

/** Bảng thả xuống của chuông: danh sách (tải/lỗi/rỗng) hoặc cài đặt cảnh báo. */
export function NotificationPanel({
  query,
  onClose,
}: {
  query: UseQueryResult<NotificationListResponse>
  onClose: () => void
}) {
  const [view, setView] = useState<'list' | 'settings'>('list')
  const [, navigate] = useLocation()
  const markRead = useMarkRead()
  const items = query.data?.items ?? []
  const unread = query.data?.unread ?? 0

  const open = (n: NotificationView) => {
    if (!n.read) markRead.mutate({ ids: [n.id] })
    if (n.link_id !== null) {
      navigate(`/links/${n.link_id}`)
      onClose()
    }
  }

  return (
    <div
      id="notif-panel"
      role="dialog"
      aria-label={strings.notifTitle}
      className="fixed inset-x-3 top-14 z-40 max-h-[75vh] overflow-y-auto rounded-md border border-line bg-surface shadow-lg sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-1 sm:w-96"
    >
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <h2 className="text-sm font-semibold text-ink">
          {view === 'list' ? strings.notifTitle : strings.alertSettingsTitle}
        </h2>
        <div className="flex items-center gap-1">
          {view === 'list' && (
            <Button
              size="sm"
              variant="ghost"
              disabled={unread === 0 || markRead.isPending}
              onClick={() => markRead.mutate({ all: true })}
            >
              {strings.notifMarkAll}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setView(view === 'list' ? 'settings' : 'list')}
          >
            {view === 'list' ? strings.notifOpenSettings : strings.notifBackToList}
          </Button>
        </div>
      </div>

      {view === 'settings' ? (
        <AlertSettingsForm />
      ) : query.isPending ? (
        <p className="px-3 py-6 text-center text-sm text-muted">{strings.notifLoading}</p>
      ) : query.isError ? (
        <div className="px-3 py-6 text-center text-sm text-loss">
          <p>{strings.notifError}</p>
          <Button size="sm" className="mt-2" onClick={() => query.refetch()}>
            {strings.retry}
          </Button>
        </div>
      ) : items.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-muted">{strings.notifEmpty}</p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((n) => (
            <Item key={n.id} n={n} onOpen={open} />
          ))}
        </ul>
      )}
    </div>
  )
}
