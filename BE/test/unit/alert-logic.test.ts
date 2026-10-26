import {
  type AlertReportBody,
  formatDurationVi,
  formatMoney,
  formatPct,
  lossBp,
} from '@az-sentinel/shared'
import { describe, expect, it } from 'vitest'
import {
  type AlertState,
  decideAlert,
  EMPTY_STATE,
  lossGrowthPct,
  STALE_EPISODE_SEC,
} from '../../src/services/alert-logic'

const CTX = { login: 1234, server: 'Demo-1' }
const T0 = 1_760_000_000
const HOUR = 3600

const report = (over: Partial<AlertReportBody> = {}): AlertReportBody => ({
  aseq: T0,
  kind: 'breach',
  ts: T0,
  bal: 10_000,
  eq: 9_000,
  fl: -1_000,
  n: 3,
  ccy: 'USC',
  ...over,
})

const openState = (over: Partial<AlertState> = {}): AlertState => ({
  episode_open: 1,
  ep_started_at: T0,
  last_notified_at: T0,
  last_notified_fl: -1_000,
  last_aseq: T0,
  ...over,
})

describe('lossBp / lossGrowthPct', () => {
  it('lossBp: lỗ 10% Balance = 1000 bp; không lỗ hoặc Balance <= 0 là 0', () => {
    expect(lossBp(-1_000, 10_000)).toBeCloseTo(1_000)
    expect(lossBp(50, 10_000)).toBe(0)
    expect(lossBp(-50, 0)).toBe(0)
  })

  it('chế độ balance: -1000 -> -1200 trên Balance 10000 là 2%', () => {
    expect(lossGrowthPct(1_000, 1_200, 10_000, 'balance')).toBeCloseTo(2)
  })

  it('chế độ float: -1000 -> -1020 là 2%; -1000 -> -1200 là 20%', () => {
    expect(lossGrowthPct(1_000, 1_020, 10_000, 'float')).toBeCloseTo(2)
    expect(lossGrowthPct(1_000, 1_200, 10_000, 'float')).toBeCloseTo(20)
  })

  it('mẫu số không hợp lệ thì 0', () => {
    expect(lossGrowthPct(1_000, 1_200, 0, 'balance')).toBe(0)
    expect(lossGrowthPct(0, 100, 10_000, 'float')).toBe(0)
  })
})

describe('decideAlert: breach', () => {
  it('lần đầu vượt ngưỡng: warn, mở đợt, ghi lần báo', () => {
    const d = decideAlert(report(), EMPTY_STATE, 500, T0, CTX)
    expect(d.notify?.kind).toBe('warn')
    if (!d.notify) throw new Error('phải báo')
    expect(d.state).toMatchObject({
      episode_open: 1,
      ep_started_at: T0,
      last_notified_at: T0,
      last_notified_fl: -1_000,
      last_aseq: T0,
    })
    expect(d.notify.body).toContain('1234')
    expect(d.notify.body).toContain('-1000 USC')
  })

  it('chưa tới ngưỡng thì im lặng', () => {
    expect(decideAlert(report({ fl: -300 }), EMPTY_STATE, 500, T0, CTX).notify).toBeNull()
  })

  it('tắt cảnh báo (cfgBp = 0) thì im lặng dù EA báo', () => {
    expect(decideAlert(report(), EMPTY_STATE, 0, T0, CTX).notify).toBeNull()
  })

  it('trong 1 tiếng kể từ lần báo trước: im lặng, kể cả lỗ tăng mạnh', () => {
    const d = decideAlert(
      report({ aseq: T0 + 60, fl: -3_000 }),
      openState(),
      500,
      T0 + HOUR - 1,
      CTX,
    )
    expect(d.notify).toBeNull()
  })

  it('sau cooldown, balance mode: tăng từ -1000 lên -1200 (2% Balance) thì báo increase', () => {
    const d = decideAlert(
      report({ aseq: T0 + HOUR + 5, fl: -1_200 }),
      openState(),
      500,
      T0 + HOUR + 5 * 60,
      CTX,
      'balance',
    )
    expect(d.notify?.kind).toBe('increase')
    if (!d.notify) throw new Error('phải báo')
    expect(d.notify.body).toBe(
      'Float P/L Tài khoản 1234 đã tăng 2% so với 1 tiếng 5 phút trước, mức lỗ ghi nhận hiện tại là -1200 USC.',
    )
    expect(d.notify.data.growth_mode).toBe('balance')
    expect(d.state).toMatchObject({ last_notified_fl: -1_200, last_notified_at: T0 + HOUR + 300 })
  })

  it('mặc định (không truyền mode) là balance', () => {
    const a = decideAlert(report({ aseq: T0 + 2, fl: -1_200 }), openState(), 500, T0 + HOUR, CTX)
    const b = decideAlert(
      report({ aseq: T0 + 2, fl: -1_200 }),
      openState(),
      500,
      T0 + HOUR,
      CTX,
      'balance',
    )
    expect(a).toEqual(b)
  })

  it('sau cooldown, balance mode: tăng dưới 1% Balance thì im lặng và KHÔNG đổi trạng thái', () => {
    const d = decideAlert(
      report({ aseq: T0 + 2, fl: -1_050 }), // +0.5% Balance
      openState(),
      500,
      T0 + 2 * HOUR,
      CTX,
      'balance',
    )
    expect(d.notify).toBeNull()
  })

  it('cùng mức tăng -1000 -> -1050: float mode là 5% nên báo, balance mode là 0,5% nên im', () => {
    const r = report({ aseq: T0 + 2, fl: -1_050 })
    const now = T0 + 2 * HOUR
    expect(decideAlert(r, openState(), 500, now, CTX, 'float').notify?.kind).toBe('increase')
    expect(decideAlert(r, openState(), 500, now, CTX, 'balance').notify).toBeNull()
  })

  it('float mode ghi "tăng X%" theo lỗ lần trước', () => {
    const d = decideAlert(
      report({ aseq: T0 + 2, fl: -1_200 }),
      openState(),
      500,
      T0 + 2 * HOUR,
      CTX,
      'float',
    )
    expect(d.notify?.body).toContain('đã tăng 20% so với 2 tiếng trước')
    expect(d.notify?.data.growth_mode).toBe('float')
  })

  it('lỗ giảm so với lần báo trước thì im lặng (growth âm)', () => {
    const d = decideAlert(
      report({ aseq: T0 + 2, fl: -800 }),
      openState(),
      500,
      T0 + 2 * HOUR,
      CTX,
      'float',
    )
    expect(d.notify).toBeNull()
  })

  it('đợt mở quá 7 ngày mà EA chưa báo clear: coi là đợt mới (warn)', () => {
    const d = decideAlert(
      report({ aseq: T0 + 3 }),
      openState(),
      500,
      T0 + STALE_EPISODE_SEC + 1,
      CTX,
    )
    expect(d.notify?.kind).toBe('warn')
  })
})

describe('decideAlert: clear và gửi lại', () => {
  it('clear khi đang có đợt: báo ngay (không chờ cooldown) và đóng đợt', () => {
    const d = decideAlert(
      report({ aseq: T0 + 10, kind: 'clear', n: 0, closed_pl: -1_234.5 }),
      openState(),
      500,
      T0 + 30,
      CTX,
    )
    expect(d.notify?.kind).toBe('clear')
    if (!d.notify) throw new Error('phải báo')
    expect(d.notify.body).toBe('Tài khoản 1234 đã Clear lệnh với số P/L là -1234.5 USC.')
    expect(d.state).toMatchObject({ episode_open: 0, ep_started_at: null, last_aseq: T0 + 10 })
  })

  it('clear lãi hiện dấu +', () => {
    const d = decideAlert(
      report({ aseq: T0 + 10, kind: 'clear', n: 0, closed_pl: 50 }),
      openState(),
      500,
      T0 + 30,
      CTX,
    )
    expect(d.notify?.body).toContain('+50 USC')
  })

  it('clear khi không có đợt, hoặc còn lệnh (n > 0): im lặng', () => {
    const c = report({ aseq: T0 + 10, kind: 'clear', n: 0 })
    expect(decideAlert(c, EMPTY_STATE, 500, T0 + 30, CTX).notify).toBeNull()
    expect(decideAlert({ ...c, n: 2 }, openState(), 500, T0 + 30, CTX).notify).toBeNull()
  })

  it('clear vẫn báo kể cả khi người dùng đã tắt cảnh báo sau khi mở đợt', () => {
    const d = decideAlert(
      report({ aseq: T0 + 10, kind: 'clear', n: 0, closed_pl: -5 }),
      openState(),
      0,
      T0 + 30,
      CTX,
    )
    expect(d.notify?.kind).toBe('clear')
  })

  it('bản gửi lại (aseq <= last_aseq) bị bỏ', () => {
    expect(
      decideAlert(report({ aseq: T0 }), openState(), 500, T0 + 2 * HOUR, CTX).notify,
    ).toBeNull()
    expect(
      decideAlert(report({ aseq: T0 - 5 }), openState(), 500, T0 + 2 * HOUR, CTX).notify,
    ).toBeNull()
  })

  it('sau clear, đợt mới bắt đầu bằng warn', () => {
    const closed = decideAlert(
      report({ aseq: T0 + 10, kind: 'clear', n: 0, closed_pl: -1 }),
      openState(),
      500,
      T0 + 30,
      CTX,
    )
    if (!closed.notify) throw new Error('phải báo')
    const again = decideAlert(report({ aseq: T0 + 50 }), closed.state, 500, T0 + 60, CTX)
    expect(again.notify?.kind).toBe('warn')
  })
})

describe('định dạng chữ', () => {
  it('formatDurationVi', () => {
    expect(formatDurationVi(20)).toBe('dưới 1 phút')
    expect(formatDurationVi(45 * 60)).toBe('45 phút')
    expect(formatDurationVi(3600)).toBe('1 tiếng')
    expect(formatDurationVi(3600 + 5 * 60 + 30)).toBe('1 tiếng 5 phút')
    expect(formatDurationVi(2 * 3600)).toBe('2 tiếng')
  })

  it('formatMoney / formatPct', () => {
    expect(formatMoney(-1200)).toBe('-1200')
    expect(formatMoney(12.3456)).toBe('12.35')
    expect(formatMoney(5, true)).toBe('+5')
    expect(formatMoney(-0.001)).toBe('0')
    expect(formatPct(2)).toBe('2')
    expect(formatPct(1.2345)).toBe('1.23')
  })
})
