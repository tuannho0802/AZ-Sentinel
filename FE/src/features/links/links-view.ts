import type { LinkSummary, LiveState } from '@az-sentinel/shared'
import { useSyncExternalStore } from 'react'
import { useNow } from '../../lib/use-now'
import { type HealthStabilizer, pruneStabilizer, stabilizeHealth } from './health-stabilizer'
import {
  effectiveLiveState,
  getLiveEntry,
  liveVersion,
  mergeLive,
  subscribeLive,
} from './live/live-store'

/**
 * Tình trạng hiển thị của một liên kết, gộp từ trạng thái server (online, khóa, đã có dữ liệu) và
 * trạng thái live. FE không tự suy online từ giờ máy (Rules FE mục 6): `online` do server báo.
 */
export type Health = 'live' | 'waking' | 'silent' | 'online' | 'offline' | 'awaiting' | 'disabled'

export type LinkRow = {
  /** Bản D1 gốc (không phủ live). */
  raw: LinkSummary
  /** Đã phủ số liệu live nếu đang nối. */
  link: LinkSummary
  liveState: LiveState | null
  health: Health
}

export function classify(link: LinkSummary, liveState: LiveState | null): Health {
  if (link.status === 'disabled') return 'disabled'
  if (!link.state) return 'awaiting'
  if (!link.state.online) return 'offline'
  if (liveState === 'live') return 'live'
  if (liveState === 'idle') return 'silent'
  if (liveState === 'waking') return 'waking'
  return 'online'
}

/** Cần người xem để mắt tới: mất kết nối, hoặc đang có người xem mà EA im. */
export const needsAttention = (h: Health): boolean => h === 'offline' || h === 'silent'

export function buildRows(links: LinkSummary[], connected: boolean, perfNow: number): LinkRow[] {
  return links.map((raw) => {
    const entry = connected ? getLiveEntry(raw.id) : undefined
    const link = mergeLive(raw, entry)
    const liveState = raw.status === 'active' ? effectiveLiveState(entry, connected, perfNow) : null
    return { raw, link, liveState, health: classify(link, liveState) }
  })
}

const EMPTY: LinkSummary[] = []

/**
 * Bộ nhớ trạng thái đã làm mượt, đặt ở cấp module để Tổng quan và Liên kết dùng chung (chuyển trang
 * không làm mất bộ đếm ân hạn).
 */
const stabilizer: HealthStabilizer = new Map()

/** Chỉ dùng trong test. */
export const resetHealthStabilizer = (): void => stabilizer.clear()

/** Áp ân hạn lên `health` của từng dòng; `liveState`/`link` vẫn là dữ liệu thô để hiển thị số liệu thật. */
export function stabilizeRows(rows: LinkRow[], perfNow: number): LinkRow[] {
  pruneStabilizer(stabilizer, new Set(rows.map((r) => r.raw.id)))
  return rows.map((r) => {
    const health = stabilizeHealth(stabilizer, r.raw.id, r.health, perfNow)
    return health === r.health ? r : { ...r, health }
  })
}

/**
 * Các dòng của danh sách, tự tính lại khi có tin live mới và mỗi giây (để cờ "không phản hồi"
 * hạ đúng lúc khi mẫu im, và để bộ đếm ân hạn chạy kể cả khi không có tin mới). Gọi vô điều kiện
 * (quy tắc của hook): truyền `undefined` khi chưa có dữ liệu.
 *
 * Trạng thái xấu đi (mất kết nối, im lặng) chỉ hiển thị sau khi kéo dài liên tục
 * `HEALTH_DOWNGRADE_GRACE_MS`, nên mất kết nối thoáng qua không làm huy hiệu và bộ đếm "cần chú ý" nhấp nháy.
 */
export function useLinkRows(links: LinkSummary[] | undefined, connected: boolean): LinkRow[] {
  useSyncExternalStore(subscribeLive, liveVersion)
  useNow()
  const perfNow = performance.now()
  return stabilizeRows(buildRows(links ?? EMPTY, connected, perfNow), perfNow)
}

export type Filter = 'all' | 'attention' | 'live'
export type SortKey = 'vps' | 'attention' | 'equity' | 'pl'
export type View = { query: string; filter: Filter; sort: SortKey }
export const DEFAULT_VIEW: View = { query: '', filter: 'all', sort: 'vps' }

const norm = (s: string) => s.toLocaleLowerCase('vi-VN').normalize('NFC')

function matches(row: LinkRow, query: string): boolean {
  const q = norm(query.trim())
  if (q === '') return true
  const a = row.link.account
  const hay = [
    a ? String(a.login) : '',
    a?.name ?? '',
    a?.server ?? '',
    a?.broker ?? '',
    row.link.vps_name ?? '',
  ]
  return hay.some((h) => norm(h).includes(q))
}

const rank: Record<Health, number> = {
  offline: 0,
  silent: 1,
  awaiting: 2,
  waking: 3,
  online: 4,
  live: 4,
  disabled: 5,
}

/** null luôn xuống cuối, bất kể chiều sắp xếp. */
function byNumber(a: number | null | undefined, b: number | null | undefined, dir: 1 | -1) {
  const x = a ?? null
  const y = b ?? null
  if (x === null && y === null) return 0
  if (x === null) return 1
  if (y === null) return -1
  return (x - y) * dir
}

function byVps(a: LinkRow, b: LinkRow): number {
  const x = a.link.vps_name
  const y = b.link.vps_name
  if (x === null && y !== null) return 1
  if (x !== null && y === null) return -1
  if (x !== null && y !== null) {
    const c = x.localeCompare(y, 'vi', { numeric: true, sensitivity: 'base' })
    if (c !== 0) return c
  }
  return a.link.id - b.link.id
}

export function applyView(rows: LinkRow[], view: View): LinkRow[] {
  const out = rows.filter((r) => {
    if (view.filter === 'attention' && !needsAttention(r.health)) return false
    if (view.filter === 'live' && r.health !== 'live') return false
    return matches(r, view.query)
  })
  const cmp: Record<SortKey, (a: LinkRow, b: LinkRow) => number> = {
    vps: byVps,
    attention: (a, b) => rank[a.health] - rank[b.health] || byVps(a, b),
    equity: (a, b) => byNumber(a.link.state?.equity, b.link.state?.equity, -1) || byVps(a, b),
    pl: (a, b) => byNumber(a.link.state?.floating_pl, b.link.state?.floating_pl, 1) || byVps(a, b),
  }
  return out.sort(cmp[view.sort])
}

export type CurrencyTotal = { currency: string; count: number; equity: number; pl: number }

export type Summary = {
  total: number
  /** Đang truyền trực tiếp. */
  live: number
  /** Online theo server (gồm cả live). */
  online: number
  attention: number
  awaiting: number
  disabled: number
  /** Tổng theo từng loại tiền, chỉ cho loại có từ 2 tài khoản có số liệu (không cộng gộp khác tiền tệ). */
  totals: CurrencyTotal[]
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function summarize(rows: LinkRow[]): Summary {
  const s: Summary = {
    total: rows.length,
    live: 0,
    online: 0,
    attention: 0,
    awaiting: 0,
    disabled: 0,
    totals: [],
  }
  const byCurrency = new Map<string, CurrencyTotal>()
  for (const r of rows) {
    if (r.health === 'live') s.live += 1
    if (r.health === 'live' || r.health === 'online' || r.health === 'waking') s.online += 1
    if (needsAttention(r.health)) s.attention += 1
    if (r.health === 'awaiting') s.awaiting += 1
    if (r.health === 'disabled') s.disabled += 1
    const cur = r.link.account?.currency
    const st = r.link.state
    if (cur && st && st.equity !== null && r.health !== 'disabled') {
      const t = byCurrency.get(cur) ?? { currency: cur, count: 0, equity: 0, pl: 0 }
      t.count += 1
      t.equity += st.equity
      t.pl += st.floating_pl ?? 0
      byCurrency.set(cur, t)
    }
  }
  s.totals = [...byCurrency.values()]
    .filter((t) => t.count >= 2)
    .map((t) => ({ ...t, equity: round2(t.equity), pl: round2(t.pl) }))
    .sort((a, b) => a.currency.localeCompare(b.currency))
  return s
}
