import {
  ALERT,
  type AlertReportBody,
  formatDurationVi,
  formatMoney,
  formatPct,
  lossBp,
  type NotificationData,
  type NotificationKind,
} from '@az-sentinel/shared'

/** Đợt cảnh báo mở quá lâu mà EA không bao giờ báo `clear` (mất cờ trên terminal): coi như đợt mới. */
export const STALE_EPISODE_SEC = 7 * 24 * 3600

/** Dòng `alert_state` (hoặc mặc định khi liên kết chưa có đợt nào). */
export type AlertState = {
  episode_open: 0 | 1
  ep_started_at: number | null
  last_notified_at: number | null
  last_notified_fl: number | null
  last_aseq: number
}

export const EMPTY_STATE: AlertState = {
  episode_open: 0,
  ep_started_at: null,
  last_notified_at: null,
  last_notified_fl: null,
  last_aseq: 0,
}

export type AlertContext = {
  login: number | null
  server: string | null
}

export type Notice = {
  kind: NotificationKind
  title: string
  body: string
  data: NotificationData
}

export type Decision =
  /** Không có gì để báo; `state` không đổi và không ghi gì. */
  | { notify: null }
  /** Báo và ghi trạng thái mới. */
  | { notify: Notice; state: AlertState }

const NO = { notify: null } as const

function who(ctx: AlertContext): string {
  return ctx.login === null ? 'EA' : String(ctx.login)
}

function base(report: AlertReportBody, ctx: AlertContext): NotificationData {
  return {
    ...(ctx.login !== null ? { login: ctx.login } : {}),
    ...(ctx.server !== null ? { server: ctx.server } : {}),
    ...(report.ccy ? { ccy: report.ccy } : {}),
    bal: report.bal,
    fl: report.fl,
  }
}

const unit = (report: AlertReportBody) => (report.ccy ? ` ${report.ccy}` : '')

/**
 * Luật thông báo (một nguồn sự thật, EA chỉ phát hiện):
 * - `breach` khi chưa có đợt: báo "warn" và mở đợt.
 * - `breach` khi đang có đợt: im lặng trong `cooldownSec` kể từ lần báo trước; sau đó chỉ báo "increase" nếu mức
 *   lỗ hiện tại lớn hơn lần báo trước ít nhất `minIncreasePct`%, ngược lại im lặng.
 * - `clear` (EA hết lệnh) khi đang có đợt: báo "clear" kèm lãi/lỗ đã chốt NGAY (không phải báo lặp) và đóng đợt.
 * Ngưỡng lấy từ cài đặt hiện tại ở Server, không tin ngưỡng EA đang giữ (có thể cũ).
 */
export function decideAlert(
  report: AlertReportBody,
  state: AlertState,
  cfgBp: number,
  now: number,
  ctx: AlertContext,
): Decision {
  // Bản gửi lại của báo cáo cũ hơn lần đổi trạng thái gần nhất.
  if (report.aseq <= state.last_aseq) return NO

  if (report.kind === 'clear') {
    if (state.episode_open !== 1 || report.n > 0) return NO
    const data: NotificationData = {
      ...base(report, ctx),
      ...(report.closed_pl !== undefined ? { closed_pl: report.closed_pl } : {}),
    }
    const pl =
      report.closed_pl === undefined
        ? ''
        : ` với số P/L là ${formatMoney(report.closed_pl, true)}${unit(report)}`
    return {
      notify: {
        kind: 'clear',
        title: 'Tài khoản đã clear lệnh',
        body: `Tài khoản ${who(ctx)} đã Clear lệnh${pl}.`,
        data,
      },
      state: { ...state, episode_open: 0, ep_started_at: null, last_aseq: report.aseq },
    }
  }

  // breach
  if (cfgBp <= 0) return NO
  const bp = lossBp(report.fl, report.bal)
  if (bp < cfgBp) return NO

  const lossPct = bp / 100
  const thrPct = cfgBp / 100
  const fresh = (): Decision => ({
    notify: {
      kind: 'warn',
      title: 'Cảnh báo lỗ float',
      body: `Tài khoản ${who(ctx)} đang lỗ float ${formatMoney(report.fl)}${unit(report)} (${formatPct(lossPct)}% Balance), vượt ngưỡng cảnh báo ${formatPct(thrPct)}%.`,
      data: { ...base(report, ctx), loss_pct: lossPct, thr_pct: thrPct },
    },
    state: {
      episode_open: 1,
      ep_started_at: now,
      last_notified_at: now,
      last_notified_fl: report.fl,
      last_aseq: report.aseq,
    },
  })

  const last = state.last_notified_at
  const prev = state.last_notified_fl
  if (state.episode_open !== 1 || last === null || prev === null || prev >= 0) return fresh()
  if (now - last >= STALE_EPISODE_SEC) return fresh()
  const since = now - last
  if (since < ALERT.cooldownSec) return NO

  const prevLoss = -prev
  const growth = ((-report.fl - prevLoss) / prevLoss) * 100
  if (growth < ALERT.minIncreasePct) return NO

  return {
    notify: {
      kind: 'increase',
      title: 'Float lỗ tăng thêm',
      body: `Float P/L Tài khoản ${who(ctx)} đã tăng ${formatPct(growth)}% so với ${formatDurationVi(since)} trước, mức lỗ ghi nhận hiện tại là ${formatMoney(report.fl)}${unit(report)}.`,
      data: {
        ...base(report, ctx),
        loss_pct: lossPct,
        thr_pct: thrPct,
        prev_fl: prev,
        growth_pct: growth,
        since_sec: since,
      },
    },
    state: {
      episode_open: 1,
      ep_started_at: state.ep_started_at ?? now,
      last_notified_at: now,
      last_notified_fl: report.fl,
      last_aseq: report.aseq,
    },
  }
}
