import type { StatsRequest } from '@az-sentinel/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import { Gateway } from '../src/gateway'
import { bound, fakeCloud, KEY, ping } from './helpers'

let clock = 1_000_000
const now = () => clock
const TID = '111@Demo-1'

const bucket = (pl: number, n: number, w: number) => ({ pl, n, w })
const period = (pl: number) => ({
  from: 1_760_000_000,
  to: 1_760_086_400,
  open: bucket(pl, 2, 1),
  close: bucket(pl + 1, 3, 2),
})

function statsReq(pl = 10, over: Partial<StatsRequest> = {}): StatsRequest {
  return {
    v: 1,
    sid: 'S1',
    key: KEY,
    login: 111,
    server: 'Demo-1',
    sts: 1_760_000_100,
    ccy: 'USD',
    periods: {
      today: period(pl),
      yesterday: period(1),
      d3: period(2),
      lastweek: period(3),
      lastmonth: period(4),
    },
    ...over,
  }
}

/** Gateway đã bind, terminal đang được xem riêng (trang chi tiết). */
function setup(fast = true) {
  const gw = new Gateway({ now, idleFlushSec: 0 })
  const cloud = fakeCloud()
  gw.onCloudOpen(cloud.send)
  gw.handlePing(ping())
  gw.onCloudMessage(bound(TID))
  gw.onCloudMessage({ t: 'watch', tids: [TID], push_sec: 1, ...(fast ? { fast: [TID] } : {}) })
  cloud.clear()
  return { gw, cloud }
}

beforeEach(() => {
  clock = 1_000_000
})

describe('thống kê lãi/lỗ theo kỳ (EA 0.7.0)', () => {
  it('stats_on chỉ có khi terminal được xem riêng', () => {
    expect(setup(true).gw.handlePing(ping()).stats_on).toBe(true)
    expect(setup(false).gw.handlePing(ping()).stats_on).toBeUndefined()
  })

  it('đang xem riêng: chuyển nguyên lên cloud, bản giống hệt không đẩy lại', () => {
    const { gw, cloud } = setup()
    expect(gw.handleStats(statsReq(10))).toEqual({ ok: true })
    const first = cloud.of('stats')
    expect(first).toHaveLength(1)
    expect(first[0]?.tid).toBe(TID)
    expect(first[0]?.periods.today.close.pl).toBe(11)
    expect(first[0]?.ccy).toBe('USD')

    gw.handleStats(statsReq(10, { sts: 1_760_000_200 })) // chỉ khác sts
    expect(cloud.of('stats')).toHaveLength(1)

    gw.handleStats(statsReq(25)) // số đổi
    expect(cloud.of('stats')).toHaveLength(2)
  })

  it('không ai xem riêng: bỏ, không đẩy và không giữ cho lần xem sau', () => {
    const { gw, cloud } = setup(false)
    expect(gw.handleStats(statsReq())).toEqual({ ok: true })
    expect(cloud.of('stats')).toHaveLength(0)
    gw.onCloudMessage({ t: 'watch', tids: [TID], push_sec: 1, fast: [TID] })
    expect(cloud.of('stats')).toHaveLength(0)
  })

  it('terminal lạ hoặc sai khóa trả null (local server trả 409)', () => {
    const { gw } = setup()
    expect(gw.handleStats(statsReq(10, { login: 999 }))).toBeNull()
    expect(gw.handleStats(statsReq(10, { key: 'sai-khoa-0123456789' }))).toBeNull()
  })

  it('hết xem riêng thì bỏ bản cũ: lần xem sau không đẩy số cũ', () => {
    const { gw, cloud } = setup()
    gw.handleStats(statsReq(10))
    cloud.clear()
    gw.onCloudMessage({ t: 'watch', tids: [], push_sec: 1 })
    gw.onCloudMessage({ t: 'watch', tids: [TID], push_sec: 1, fast: [TID] })
    expect(cloud.of('stats')).toHaveLength(0)
  })

  it('đổi từ xem danh sách sang xem riêng: đẩy ngay bản EA đã gửi', () => {
    const { gw, cloud } = setup(false)
    gw.onCloudMessage({ t: 'watch', tids: [TID], push_sec: 1, fast: [TID] })
    gw.handleStats(statsReq(10))
    expect(cloud.of('stats')).toHaveLength(1)
  })

  it('giữ sống: đẩy lại bản đang giữ mỗi 60 giây khi vẫn có người xem', () => {
    const { gw, cloud } = setup()
    gw.handleStats(statsReq(10))
    expect(cloud.of('stats')).toHaveLength(1)
    clock += 15_000
    gw.handlePing(ping())
    gw.sweep()
    expect(cloud.of('stats')).toHaveLength(1)
    for (let i = 0; i < 3; i++) {
      clock += 15_000
      gw.handlePing(ping())
    }
    gw.sweep()
    expect(cloud.of('stats')).toHaveLength(2)
  })

  it('mất cloud thì bỏ bản giữ, nối lại không đẩy số cũ', () => {
    const { gw } = setup()
    gw.handleStats(statsReq(10))
    gw.onCloudClose()
    const cloud2 = fakeCloud()
    gw.onCloudOpen(cloud2.send)
    gw.sweep()
    expect(cloud2.of('stats')).toHaveLength(0)
  })
})
