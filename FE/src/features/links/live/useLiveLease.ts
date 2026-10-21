import { type KickReason, serverMessageSchema } from '@az-sentinel/shared'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { apiGet } from '../../../lib/api-client'
import { applyLiveMessage, clearLive, liveVersion, subscribeLive } from './live-store'

/** Hằng số FE của Plan 3B mục 6. */
export const HIDDEN_GRACE_MS = 10_000
export const IDLE_PAUSE_MS = 10 * 60_000
export const HEARTBEAT_MS = 25_000
/** Khoảng chờ nối lại (giây) theo thứ tự thử; tối đa 8 lần rồi `disconnected`. */
export const BACKOFF_SECONDS = [1, 2, 4, 8, 16, 30, 30, 30] as const
export const PAUSED_STORAGE_KEY = 'az.live.paused'

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'wheel', 'scroll', 'touchstart']

export type LiveStatus =
  | 'off'
  | 'paused'
  | 'idle_paused'
  | 'kicked'
  | 'hidden'
  | 'connecting'
  | 'open'
  | 'disconnected'

function readPaused(): boolean {
  try {
    return localStorage.getItem(PAUSED_STORAGE_KEY) === '1'
  } catch {
    return false // F-08: localStorage hỏng thì mặc định Live bật
  }
}
function writePaused(value: boolean): void {
  try {
    localStorage.setItem(PAUSED_STORAGE_KEY, value ? '1' : '0')
  } catch {
    // bỏ qua: chỉ mất khả năng nhớ lựa chọn
  }
}

/**
 * Phạm vi xem: cả danh sách (`/links`) hoặc đúng một liên kết (`/links/:id`). Server tự kiểm quyền
 * và chỉ phát dữ liệu của phạm vi này; trang chi tiết nhờ đó chỉ live đúng tài khoản đang mở.
 */
export type LiveScope = { kind: 'links' } | { kind: 'link'; id: number }
const LIST_SCOPE: LiveScope = { kind: 'links' }

const scopeKey = (scope: LiveScope) => (scope.kind === 'link' ? `link:${scope.id}` : 'links')

export function liveUrl(scope: LiveScope = LIST_SCOPE): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const query = scope.kind === 'link' ? `scope=link&id=${scope.id}` : 'scope=links'
  return `${proto}://${window.location.host}/api/live/ws?${query}`
}

function helloMessage(scope: LiveScope): string {
  return JSON.stringify(
    scope.kind === 'link'
      ? { t: 'hello', scope: 'link', id: scope.id }
      : { t: 'hello', scope: 'links' },
  )
}

type Options = {
  /** Đã đăng nhập và đang ở route `/links` hoặc `/links/:id`. */
  enabled: boolean
  /** Mặc định cả danh sách. Đổi phạm vi thì đóng kết nối cũ và mở lại (vẫn tối đa một socket). */
  scope?: LiveScope
  /** Gọi khi nối lại (không phải lần đầu): cho phép làm mới danh sách từ D1 đúng một lần. */
  onResync: () => void
  /** Chèn được để test canh thời điểm nối lại chính xác. */
  random?: () => number
}

/**
 * Điều khiển toàn bộ vòng đời WebSocket live. Chỉ mở kết nối khi đủ bốn điều kiện: đang ở
 * `/links`, đã đăng nhập, công tắc Live bật, tab đang hiện (hoặc ẩn chưa quá 10 giây).
 * Luôn có tối đa MỘT socket mở cho mỗi tab (F-19).
 */
export function useLiveLease({
  enabled,
  scope = LIST_SCOPE,
  onResync,
  random = Math.random,
}: Options) {
  const [paused, setPaused] = useState(readPaused)
  const [idlePaused, setIdlePaused] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [kick, setKick] = useState<KickReason | null>(null)
  const [conn, setConn] = useState<'connecting' | 'open' | 'disconnected'>('connecting')
  const [nonce, setNonce] = useState(0)

  const resyncRef = useRef(onResync)
  const randomRef = useRef(random)
  const everOpened = useRef(false)
  useEffect(() => {
    resyncRef.current = onResync
    randomRef.current = random
  })

  // Tab ẩn: chờ 10 giây rồi mới đóng; hiện lại trong thời gian đó thì không đổi gì.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const apply = () => {
      if (document.visibilityState === 'hidden') {
        timer ??= setTimeout(() => setHidden(true), HIDDEN_GRACE_MS)
      } else {
        clearTimeout(timer)
        timer = undefined
        setHidden(false)
      }
    }
    apply()
    document.addEventListener('visibilitychange', apply)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', apply)
    }
  }, [])

  // Không thao tác 10 phút thì tự tạm dừng (chặn để tab mở cả ngày không ai nhìn).
  useEffect(() => {
    if (!enabled || paused || idlePaused) return
    let timer = setTimeout(() => setIdlePaused(true), IDLE_PAUSE_MS)
    let lastReset = Date.now()
    const onActivity = () => {
      const now = Date.now()
      if (now - lastReset < 1000) return
      lastReset = now
      clearTimeout(timer)
      timer = setTimeout(() => setIdlePaused(true), IDLE_PAUSE_MS)
    }
    for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, onActivity, { passive: true })
    return () => {
      clearTimeout(timer)
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, onActivity)
    }
  }, [enabled, paused, idlePaused])

  const shouldConnect = enabled && !paused && !idlePaused && !hidden && kick === null
  const key = scopeKey(scope)
  const scopeRef = useRef(scope)
  useEffect(() => {
    scopeRef.current = scope
  })

  // `nonce` đổi (nút Thử lại) hoặc `key` (phạm vi xem) đổi thì chạy lại effect để làm lại từ đầu.
  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce và key chủ ý kích hoạt nối lại
  useEffect(() => {
    if (!shouldConnect) return
    const liveScope = scopeRef.current

    let ws: WebSocket | null = null
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let hbTimer: ReturnType<typeof setInterval> | undefined
    let attempts = 0
    let stopped = false
    let suspended = false
    let probed = false

    const detach = (sock: WebSocket) => {
      sock.onopen = null
      sock.onmessage = null
      sock.onclose = null
      sock.onerror = null
    }

    const connect = () => {
      if (stopped) return
      clearTimeout(retryTimer)
      clearInterval(hbTimer)
      if (ws) {
        detach(ws)
        ws.close(1000)
        ws = null
      }
      setConn('connecting')
      const sock = new WebSocket(liveUrl(liveScope))
      ws = sock
      sock.onopen = () => {
        if (ws !== sock) return
        setConn('open')
        sock.send(helloMessage(liveScope))
        hbTimer = setInterval(() => {
          if (sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify({ t: 'hb' }))
        }, HEARTBEAT_MS)
        if (everOpened.current) resyncRef.current()
        everOpened.current = true
      }
      sock.onmessage = (e) => {
        if (ws !== sock) return
        let raw: unknown
        try {
          raw = JSON.parse(String(e.data))
        } catch {
          return
        }
        const msg = serverMessageSchema.safeParse(raw)
        if (!msg.success) return
        if (msg.data.t === 'kick') {
          stopped = true
          clearInterval(hbTimer)
          setKick(msg.data.reason)
          detach(sock)
          sock.close(1000)
          ws = null
          if (msg.data.reason === 'session_expired') {
            // 401 sẽ đi qua api-client và đưa người dùng về trang đăng nhập.
            apiGet('/api/me').catch(() => {})
          }
          return
        }
        if (msg.data.t === 'snapshot') attempts = 0
        applyLiveMessage(msg.data)
      }
      sock.onclose = () => {
        if (ws !== sock) return
        ws = null
        clearInterval(hbTimer)
        if (stopped || suspended) return
        schedule()
      }
      sock.onerror = () => {
        // `onclose` luôn theo sau; xử lý ở đó.
      }
    }

    const schedule = () => {
      attempts += 1
      if (!probed) {
        probed = true
        // Lần nâng cấp thất bại không đọc được mã HTTP: kiểm tra phiên một lần để bắt 401.
        apiGet('/api/me').catch(() => {})
      }
      if (attempts > BACKOFF_SECONDS.length) {
        setConn('disconnected')
        return
      }
      setConn('connecting')
      const base = (BACKOFF_SECONDS[attempts - 1] ?? 30) * 1000
      retryTimer = setTimeout(connect, base * (0.8 + 0.4 * randomRef.current()))
    }

    const onOnline = () => {
      if (stopped || suspended || ws !== null) return
      attempts = 0
      connect()
    }
    const onPageHide = () => {
      suspended = true
      clearTimeout(retryTimer)
      clearInterval(hbTimer)
      if (ws) {
        detach(ws)
        ws.close(1000)
        ws = null
      }
    }
    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted || !suspended) return
      suspended = false
      attempts = 0
      connect()
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('pageshow', onPageShow)

    connect()

    return () => {
      stopped = true
      clearTimeout(retryTimer)
      clearInterval(hbTimer)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('pageshow', onPageShow)
      if (ws) {
        detach(ws)
        ws.close(1000)
        ws = null
      }
      clearLive()
    }
  }, [shouldConnect, nonce, key])

  const pause = useCallback(() => {
    writePaused(true)
    setPaused(true)
  }, [])
  const resume = useCallback(() => {
    writePaused(false)
    setPaused(false)
    setIdlePaused(false)
    setKick(null)
  }, [])
  const retry = useCallback(() => setNonce((n) => n + 1), [])

  // Re-render khi dữ liệu live đổi.
  useSyncExternalStore(subscribeLive, liveVersion)

  let status: LiveStatus
  if (!enabled) status = 'off'
  else if (kick !== null) status = 'kicked'
  else if (paused) status = 'paused'
  else if (idlePaused) status = 'idle_paused'
  else if (hidden) status = 'hidden'
  else status = conn

  return { status, connected: status === 'open', kick, pause, resume, retry }
}
