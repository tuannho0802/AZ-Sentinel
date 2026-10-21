import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { Link } from 'wouter'
import { Button } from '../../components/Button'
import { Icon } from '../../components/Icon'
import { Skeleton } from '../../components/Skeleton'
import { ApiError } from '../../lib/api-client'
import { formatTime } from '../../lib/format'
import { strings } from '../../lib/strings'
import { linkKey, useLink } from './api'
import { LinkDetailView } from './LinkDetailView'
import { LiveBanners, LiveControl } from './live/LiveControl'
import { effectiveLiveState, getLiveEntry, mergeLiveDetail } from './live/live-store'
import { useLiveLease } from './live/useLiveLease'

/** Chờ chừng này ms sau khi danh sách lệnh đổi rồi mới làm mới D1: sự kiện giao dịch đến D1 muộn hơn một chút. */
const EVENTS_REFRESH_DELAY_MS = 1500

/**
 * Trang một liên kết. Live đúng liên kết này (`scope=link`): server chỉ phát dữ liệu của nó, và
 * cũng chỉ yêu cầu EA của nó đẩy theo tick. D1 chỉ tải lúc vào, lúc nối lại, khi bấm Làm mới, và
 * một lần sau mỗi lần mở/đóng lệnh (để mục Sự kiện cập nhật).
 */
export function LinkDetailPanel({ id }: { id: number }) {
  const client = useQueryClient()
  const q = useLink(id)
  const notFound = q.error instanceof ApiError && q.error.status === 404
  const live = useLiveLease({
    // Chỉ nối khi đã tải được liên kết (không mở socket cho id không tồn tại hoặc không có quyền).
    enabled: q.isSuccess,
    scope: { kind: 'link', id },
    onResync: () => void client.invalidateQueries({ queryKey: linkKey(id) }),
  })

  const entry = live.connected ? getLiveEntry(id) : undefined
  const liveState =
    q.data?.status === 'active'
      ? effectiveLiveState(entry, live.connected, performance.now())
      : null

  // Mở/đóng lệnh: dấu vân tay là tập ticket. Lần đầu có danh sách chỉ ghi nhớ, không làm mới.
  const ticketsSig = entry?.positions?.map((p) => p.ticket).join(',')
  const lastSig = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (ticketsSig === undefined) return
    const prev = lastSig.current
    lastSig.current = ticketsSig
    if (prev === undefined || prev === ticketsSig) return
    const timer = setTimeout(
      () => void client.invalidateQueries({ queryKey: linkKey(id) }),
      EVENTS_REFRESH_DELAY_MS,
    )
    return () => clearTimeout(timer)
  }, [ticketsSig, client, id])
  // Mất kết nối thì quên dấu vân tay cũ: lần có danh sách kế tiếp chỉ ghi nhớ lại.
  useEffect(() => {
    if (!live.connected) lastSig.current = undefined
  }, [live.connected])

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Link
          href="/links"
          className="inline-flex items-center gap-1 text-sm font-medium text-muted transition-colors hover:text-ink"
        >
          <Icon name="back" size={14} />
          {strings.detailBack}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          {q.isSuccess && (
            <LiveControl
              status={live.status}
              anyLive={liveState === 'live'}
              kick={live.kick}
              onPause={live.pause}
              onResume={live.resume}
              onRetry={live.retry}
            />
          )}
          {/* Giờ tải D1 chỉ có nghĩa khi không live; đang live thì số liệu đổi theo tick. */}
          {q.dataUpdatedAt > 0 && liveState !== 'live' && (
            <span className="num text-sm text-muted">
              {strings.updatedAt} {formatTime(q.dataUpdatedAt)}
            </span>
          )}
          <Button size="sm" className="h-8" onClick={() => q.refetch()}>
            <Icon name="refresh" size={13} />
            {strings.refresh}
          </Button>
        </div>
      </div>
      {q.isSuccess && <LiveBanners status={live.status} kick={live.kick} onRetry={live.retry} />}
      <div className="mt-4">
        {q.isPending && <Skeleton label={strings.detailLoading} rows={5} />}
        {q.isError && (
          <div role="alert" className="rounded-lg border border-line bg-surface p-5">
            <p className="text-loss">{notFound ? strings.detailNotFound : strings.detailError}</p>
            {!notFound && (
              <Button className="mt-3" onClick={() => q.refetch()}>
                {strings.retry}
              </Button>
            )}
          </div>
        )}
        {q.isSuccess && (
          <LinkDetailView link={mergeLiveDetail(q.data, entry)} liveState={liveState} />
        )}
      </div>
    </div>
  )
}
