import { strings } from '../../../lib/strings'
import type { LiveStatus } from './useLiveLease'

type Props = {
  status: LiveStatus
  anyLive: boolean
  kick: 'session_expired' | 'too_many_tabs' | null
  onPause: () => void
  onResume: () => void
  onRetry: () => void
}

function label(status: LiveStatus, anyLive: boolean): string {
  switch (status) {
    case 'open':
      return anyLive ? strings.liveRunning : strings.liveWaking
    case 'connecting':
      return strings.liveConnecting
    case 'paused':
    case 'idle_paused':
    case 'hidden':
      return strings.livePaused
    case 'disconnected':
      return strings.liveDisconnected
    case 'kicked':
      return strings.liveKicked
    case 'off':
      return ''
  }
}

/** Nút Live (aria-pressed) + vùng trạng thái đọc được bằng trình đọc màn hình + banner. */
export function LiveControl({ status, anyLive, kick, onPause, onResume, onRetry }: Props) {
  const pressed = status !== 'paused' && status !== 'idle_paused' && status !== 'kicked'
  return (
    <div className="flex flex-col items-end gap-1 text-sm">
      <div className="flex items-center gap-2">
        <span role="status" aria-live="polite" className="text-gray-600">
          {label(status, anyLive)}
        </span>
        <button
          type="button"
          aria-pressed={pressed}
          className="rounded border px-3 py-1"
          onClick={pressed ? onPause : onResume}
        >
          {pressed ? strings.livePauseButton : strings.liveResumeButton}
        </button>
      </div>
      {status === 'idle_paused' && (
        <p role="alert" className="rounded bg-yellow-50 p-2 text-yellow-800">
          {strings.liveIdleBanner}
        </p>
      )}
      {kick !== null && (
        <p role="alert" className="rounded bg-red-50 p-2 text-red-700">
          {kick === 'too_many_tabs' ? strings.liveKickTabs : strings.liveKickSession}
        </p>
      )}
      {status === 'disconnected' && (
        <p role="alert" className="flex items-center gap-2 rounded bg-red-50 p-2 text-red-700">
          {strings.liveLostText}
          <button type="button" className="rounded border px-2 py-0.5" onClick={onRetry}>
            {strings.retry}
          </button>
        </p>
      )}
    </div>
  )
}
