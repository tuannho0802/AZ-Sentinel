import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { Link } from 'wouter'
import { ApiError } from '../../lib/api-client'
import { formatTime } from '../../lib/format'
import { strings } from '../../lib/strings'
import { linkKey, useLink } from './api'
import { LinkDetailView } from './LinkDetailView'
import { LiveControl } from './live/LiveControl'
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/links" className="text-sm underline">
          ← {strings.detailBack}
        </Link>
        <div className="flex flex-wrap items-center gap-3 text-sm">
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
            <span className="text-gray-500">
              {strings.updatedAt} {formatTime(q.dataUpdatedAt)}
            </span>
          )}
          <button type="button" className="rounded border px-3 py-1" onClick={() => q.refetch()}>
            {strings.refresh}
          </button>
        </div>
      </div>
      <div className="mt-3">
        {q.isPending && <p className="text-gray-500">{strings.detailLoading}</p>}
        {q.isError && (
          <div role="alert">
            <p className="text-red-600">
              {notFound ? strings.detailNotFound : strings.detailError}
            </p>
            {!notFound && (
              <button
                type="button"
                className="mt-2 rounded border px-3 py-1"
                onClick={() => q.refetch()}
              >
                {strings.retry}
              </button>
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
