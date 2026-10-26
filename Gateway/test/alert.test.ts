import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Gateway } from '../src/gateway'
import { alertReq, bound, fakeCloud, ping } from './helpers'

let clock = 1_000_000
const now = () => clock
const TID = '111@Demo-1'

function make() {
  const gw = new Gateway({ now, idleFlushSec: 0 })
  const cloud = fakeCloud()
  return { gw, cloud }
}

beforeEach(() => {
  clock = 1_000_000
})
afterEach(() => {
  clock = 1_000_000
})

describe('alert_cfg và alert_bp', () => {
  it('mặc định 0; nhận alert_cfg thì trả cho EA trong ping và samples', () => {
    const { gw, cloud } = make()
    gw.onCloudOpen(cloud.send)
    expect(gw.handlePing(ping()).alert_bp).toBe(0)
    gw.onCloudMessage({ t: 'alert_cfg', loss_bp: 500 })
    expect(gw.handlePing(ping()).alert_bp).toBe(500)
    expect(gw.status().alertBp).toBe(500)
  })

  it('terminal lạ (idleResponse) cũng nhận alert_bp', () => {
    const { gw, cloud } = make()
    gw.onCloudOpen(cloud.send)
    gw.onCloudMessage({ t: 'alert_cfg', loss_bp: 250 })
    const r = gw.handleSamples({
      v: 1,
      sid: 'X',
      key: 'khong-co',
      login: 999,
      server: 'Demo-1',
      seq: 1,
      samples: [],
    })
    expect(r.alert_bp).toBe(250)
  })

  it('mất cloud thì giữ ngưỡng cũ; 0 là tắt', () => {
    const { gw, cloud } = make()
    gw.onCloudOpen(cloud.send)
    gw.onCloudMessage({ t: 'alert_cfg', loss_bp: 500 })
    gw.onCloudClose()
    expect(gw.handlePing(ping()).alert_bp).toBe(500)
    gw.onCloudOpen(cloud.send)
    gw.onCloudMessage({ t: 'alert_cfg', loss_bp: 0 })
    expect(gw.handlePing(ping()).alert_bp).toBe(0)
  })
})

describe('handleAlert và hàng chờ gửi lại', () => {
  it('terminal lạ: null (EA sẽ ping rồi gửi lại)', () => {
    const { gw } = make()
    expect(gw.handleAlert(alertReq())).toBeNull()
  })

  it('sai key: null', () => {
    const { gw } = make()
    gw.handlePing(ping())
    expect(gw.handleAlert(alertReq({ key: 'khac-key' }))).toBeNull()
  })

  it('bind ok: gửi alert lên cloud và trả ack_aseq cho EA', () => {
    const { gw, cloud } = make()
    gw.onCloudOpen(cloud.send)
    gw.handlePing(ping())
    gw.onCloudMessage(bound(TID))
    const r = gw.handleAlert(alertReq({ aseq: 77 }))
    expect(r).toEqual({ ok: true, ack_aseq: 77 })
    const sent = cloud.of('alert')
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ tid: TID, aseq: 77, kind: 'breach', fl: -100, ccy: 'USC' })
    expect(sent[0]).not.toHaveProperty('key')
    expect(sent[0]).not.toHaveProperty('sid')
  })

  it('chưa bind: giữ, gửi ngay khi bound', () => {
    const { gw, cloud } = make()
    gw.onCloudOpen(cloud.send)
    gw.handlePing(ping())
    expect(gw.handleAlert(alertReq({ aseq: 5 }))).toEqual({ ok: true, ack_aseq: 5 })
    expect(cloud.of('alert')).toHaveLength(0)
    gw.onCloudMessage(bound(TID))
    expect(cloud.of('alert')).toHaveLength(1)
  })

  it('chưa có alert_ack: gửi lại sau 30 giây (sweep), có ack thì ngừng', () => {
    const { gw, cloud } = make()
    gw.onCloudOpen(cloud.send)
    gw.handlePing(ping())
    gw.onCloudMessage(bound(TID))
    gw.handleAlert(alertReq({ aseq: 9 }))
    expect(cloud.of('alert')).toHaveLength(1)
    clock += 10_000
    gw.sweep()
    expect(cloud.of('alert')).toHaveLength(1)
    clock += 21_000
    gw.handlePing(ping())
    gw.sweep()
    expect(cloud.of('alert')).toHaveLength(2)
    gw.onCloudMessage({ t: 'alert_ack', tid: TID, aseq: 9 })
    clock += 60_000
    gw.handlePing(ping())
    gw.sweep()
    expect(cloud.of('alert')).toHaveLength(2)
  })

  it('cloud nối lại: gửi lại báo cáo chưa ack sau bound', () => {
    const { gw, cloud } = make()
    gw.onCloudOpen(cloud.send)
    gw.handlePing(ping())
    gw.onCloudMessage(bound(TID))
    gw.handleAlert(alertReq({ aseq: 9 }))
    gw.onCloudClose()
    gw.onCloudOpen(cloud.send)
    gw.onCloudMessage(bound(TID))
    expect(cloud.of('alert')).toHaveLength(2)
  })

  it('gửi trùng aseq không tạo bản thứ hai; breach mới thay breach cũ, clear được giữ', () => {
    const { gw, cloud } = make()
    gw.handlePing(ping())
    gw.onCloudOpen(cloud.send)
    gw.onCloudMessage(bound(TID))
    cloud.clear()
    // Chưa có bản nào ack: ngắt cloud để giữ hàng chờ
    gw.onCloudClose()
    gw.handleAlert(alertReq({ aseq: 1 }))
    gw.handleAlert(alertReq({ aseq: 1 }))
    gw.handleAlert(alertReq({ aseq: 2, fl: -150 }))
    gw.handleAlert(alertReq({ aseq: 3, kind: 'clear', n: 0, closed_pl: -140 }))
    gw.handleAlert(alertReq({ aseq: 4, fl: -200 }))
    gw.onCloudOpen(cloud.send)
    gw.onCloudMessage(bound(TID))
    const sent = cloud.of('alert')
    expect(sent.map((m) => m.aseq)).toEqual([3, 4])
    expect(sent[0]?.closed_pl).toBe(-140)
  })

  it('hàng chờ tối đa 5 báo cáo mỗi terminal', () => {
    const { gw, cloud } = make()
    gw.handlePing(ping())
    for (let i = 1; i <= 8; i++) gw.handleAlert(alertReq({ aseq: i * 10, kind: 'clear', n: 0 }))
    gw.onCloudOpen(cloud.send)
    gw.onCloudMessage(bound(TID))
    expect(cloud.of('alert').map((m) => m.aseq)).toEqual([40, 50, 60, 70, 80])
  })

  it('bị reject: bỏ hàng chờ, báo cáo mới được nhận nhưng không gửi', () => {
    const { gw, cloud } = make()
    gw.onCloudOpen(cloud.send)
    gw.handlePing(ping())
    gw.handleAlert(alertReq({ aseq: 1 }))
    gw.onCloudMessage({ t: 'reject', tid: TID, code: 403 })
    expect(gw.handleAlert(alertReq({ aseq: 2 }))).toEqual({ ok: true, ack_aseq: 2 })
    expect(cloud.of('alert')).toHaveLength(0)
  })
})
