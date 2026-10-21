import { Button } from '../../../components/Button'
import { Icon } from '../../../components/Icon'
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

function Mark({ status, anyLive }: { status: LiveStatus; anyLive: boolean }) {
    if (status === 'open' && anyLive) {
        return <span aria-hidden="true" className="az-pulse h-2 w-2 shrink-0 rounded-full bg-live" />
    }
    if (status === 'open' || status === 'connecting') {
        return (
            <span
                aria-hidden="true"
                className="az-ring h-2 w-2 shrink-0 rounded-full border-2 border-live"
            />
        )
    }
    if (status === 'disconnected' || status === 'kicked') {
        return <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-[2px] bg-loss" />
    }
    return <span aria-hidden="true" className="h-0.5 w-2.5 shrink-0 bg-subtle" />
}

/** Nút Live (aria-pressed) và chip trạng thái đọc được bằng trình đọc màn hình. */
export function LiveControl({ status, anyLive, onPause, onResume }: Props) {
    const pressed = status !== 'paused' && status !== 'idle_paused' && status !== 'kicked'
    const text = label(status, anyLive)
    return (
        <div className="flex items-center gap-2">
            <span
                role="status"
                aria-live="polite"
                className={`inline-flex h-8 items-center gap-2 rounded-full border border-line bg-surface px-3 text-[0.8125rem] text-muted ${text === '' ? 'hidden' : ''
                    }`}
            >
                <Mark status={status} anyLive={anyLive} />
                {text}
            </span>
            <Button size="sm" aria-pressed={pressed} className="h-8" onClick={pressed ? onPause : onResume}>
                <Icon name={pressed ? 'pause' : 'play'} size={11} />
                {pressed ? strings.livePauseButton : strings.liveResumeButton}
            </Button>
        </div>
    )
}

/** Thông báo của Live: chỉ hiện khi cần (không thao tác lâu, bị ngắt, mất kết nối). */
export function LiveBanners({ status, kick, onRetry }: Pick<Props, 'status' | 'kick' | 'onRetry'>) {
    return (
        <>
            {status === 'idle_paused' && (
                <p
                    role="alert"
                    className="mt-3 flex items-center gap-2 rounded-md bg-notice-bg px-3 py-2 text-sm text-notice-ink"
                >
                    <Icon name="alert" size={14} />
                    {strings.liveIdleBanner}
                </p>
            )}
            {kick !== null && (
                <p
                    role="alert"
                    className="mt-3 flex items-center gap-2 rounded-md bg-loss-bg px-3 py-2 text-sm text-loss"
                >
                    <Icon name="alert" size={14} />
                    {kick === 'too_many_tabs' ? strings.liveKickTabs : strings.liveKickSession}
                </p>
            )}
            {status === 'disconnected' && (
                <p
                    role="alert"
                    className="mt-3 flex items-center gap-3 rounded-md bg-loss-bg px-3 py-2 text-sm text-loss"
                >
                    <Icon name="alert" size={14} />
                    {strings.liveLostText}
                    <Button size="sm" onClick={onRetry}>
                        {strings.retry}
                    </Button>
                </p>
            )}
        </>
    )
}