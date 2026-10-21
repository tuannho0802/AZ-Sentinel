import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { GW } from '@az-sentinel/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Gateway } from '../src/gateway'
import { EventQueue } from '../src/queue'
import { bound, eventReq, fakeCloud, ping, sample, samplesReq } from './helpers'

let clock = 1_000_000
const now = () => clock

function make(queue?: EventQueue) {
  const gw = new Gateway({ now, queue, idleFlushSec: 0 })
  const cloud = fakeCloud()
  return { gw, cloud }
}

beforeEach(() => {
  clock = 1_000_000
})

describe('G-01 không ai xem thì không có gì đi ra', () => {
  it('3 terminal ping, cloud nối: chỉ có hello, bind, state; không batch', () => {
    const { gw, cloud } = make()
    gw.onCloudOpen(cloud.send)
    for (const login of [1, 2, 3]) {
      gw.handlePing(ping({ login }))
      gw.onCloudMessage(bound(`${login}@Demo-1`))
    }
    gw.flush()
    expect(cloud.of('hello')).toHaveLength(1)
    expect(cloud.of('bind')).toHaveLength(3)
    expect(cloud.of('state')).toHaveLength(3)
    expect(cloud.of('batch')).toHaveLength(0)
  })

  it('samples gửi khi chưa được xem bị bỏ, không tích buffer', () => {
    const { gw, cloud } = make()
    gw.onCloudOpen(cloud.send)
    gw.handlePing(ping())
    gw.onCloudMessage(bound('111@Demo-1'))
    expect(gw.handleSamples(samplesReq()).watch).toBe(false)
    gw.onCloudMessage({ t: 'watch', tids: ['111@Demo-1'], push_sec: 2 })
    gw.flush()
    expect(cloud.of('batch')).toHaveLength(0)
  })
})

describe('G-02 và G-03 watch', () => {
  it('chỉ terminal được watch nhận watch:true và có mặt trong batch', () => {
    const { gw, cloud } = make()
    gw.onCloudOpen(cloud.send)
    for (const login of [1, 2]) {
      gw.handlePing(ping({ login }))
      gw.onCloudMessage(bound(`${login}@Demo-1`))
    }
    gw.onCloudMessage({ t: 'watch', tids: ['1@Demo-1'], push_sec: 2 })
    expect(gw.handlePing(ping({ login: 1 })).watch).toBe(true)
    expect(gw.handlePing(ping({ login: 2 })).watch).toBe(false)
    gw.handleSamples(samplesReq({ login: 1 }))
    gw.handleSamples(samplesReq({ login: 2 }))
    gw.flush()
    const batches = cloud.of('batch')
    expect(batches).toHaveLength(1)
    expect(batches[0]?.items.map((i) => i.tid)).toEqual(['1@Demo-1'])
  })

  it('watch đến trước bound vẫn có hiệu lực sau khi bound', () => {
    const { gw, cloud } = make()
    gw.onCloudOpen(cloud.send)
    gw.handlePing(ping())
    gw.onCloudMessage({ t: 'watch', tids: ['111@Demo-1'], push_sec: 2 })
    expect(gw.handlePing(ping()).watch).toBe(false)
    gw.onCloudMessage(bound('111@Demo-1'))
    expect(gw.handlePing(ping()).watch).toBe(true)
  })

  it('watch rỗng đưa EA về TRACK trong một chu kỳ ping và xóa buffer', () => {
    const { gw, cloud } = make()
    gw.onCloudOpen(cloud.send)
    gw.handlePing(ping())
    gw.onCloudMessage(bound('111@Demo-1'))
    gw.onCloudMessage({ t: 'watch', tids: ['111@Demo-1'], push_sec: 2 })
    gw.handleSamples(samplesReq())
    gw.onCloudMessage({ t: 'watch', tids: [], push_sec: 2 })
    expect(gw.handlePing(ping()).watch).toBe(false)
    gw.flush()
    expect(cloud.of('batch')).toHaveLength(0)
  })

  it('positions chỉ gửi khi đổi; mẫu lặp lại không kèm positions', () => {
    const { gw, cloud } = make()
    gw.onCloudOpen(cloud.send)
    gw.handlePing(ping())
    gw.onCloudMessage(bound('111@Demo-1'))
    gw.onCloudMessage({ t: 'watch', tids: ['111@Demo-1'], push_sec: 2 })
    const pos = [
      { ticket: 5, symbol: 'EURUSD', type: 'buy' as const, volume: 0.1, time: 1, price: 1.1 },
    ]
    gw.handleSamples(samplesReq({ seq: 1, positions: pos, pos_hash: 'h1' }))
    gw.flush()
    clock += 1000
    gw.handleSamples(samplesReq({ seq: 2 }))
    gw.flush()
    const [first, second] = cloud.of('batch')
    expect(first?.items[0]?.positions).toHaveLength(1)
    expect(first?.items[0]?.pos_hash).toBe('h1')
    expect(second?.items[0]?.positions).toBeUndefined()
  })

  it('samples trùng seq (EA gửi lại) không nhân đôi mẫu', () => {
    const { gw, cloud } = make()
    gw.onCloudOpen(cloud.send)
    gw.handlePing(ping())
    gw.onCloudMessage(bound('111@Demo-1'))
    gw.onCloudMessage({ t: 'watch', tids: ['111@Demo-1'], push_sec: 2 })
    gw.handleSamples(samplesReq({ seq: 1 }))
    gw.handleSamples(samplesReq({ seq: 1 }))
    gw.flush()
    expect(cloud.of('batch')[0]?.items[0]?.samples).toHaveLength(1)
  })

  it('terminal lạ gửi samples: trả không xem, không lỗi', () => {
    const { gw } = make()
    expect(gw.handleSamples(samplesReq({ login: 999 }))).toMatchObject({
      ok: true,
      watch: false,
      bind: 'pending',
    })
  })
})

describe('G-04 mất cloud', () => {
  it('ngắt cloud: watch về rỗng ngay; sự kiện giữ lại và gửi lại khi nối lại', () => {
    const { gw, cloud } = make()
    gw.onCloudOpen(cloud.send)
    gw.handlePing(ping())
    gw.onCloudMessage(bound('111@Demo-1'))
    gw.onCloudMessage({ t: 'watch', tids: ['111@Demo-1'], push_sec: 2 })
    expect(gw.handlePing(ping()).watch).toBe(true)

    gw.onCloudClose()
    expect(gw.handlePing(ping()).watch).toBe(false)
    expect(gw.handleEvent(eventReq({ seq: 1 }))).toEqual({ ok: true, ack_seq: 1 })
    expect(gw.status().queued).toBe(1)

    const again = fakeCloud()
    gw.onCloudOpen(again.send)
    expect(again.of('bind')).toHaveLength(1)
    expect(again.of('event')).toHaveLength(0) // chờ bound mới được gửi
    gw.onCloudMessage(bound('111@Demo-1'))
    expect(again.of('event')).toHaveLength(1)
  })

  it('cloud ack thì lô rời hàng đợi và không gửi lại', () => {
    const { gw, cloud } = make()
    gw.onCloudOpen(cloud.send)
    gw.handlePing(ping())
    gw.onCloudMessage(bound('111@Demo-1'))
    gw.handleEvent(eventReq())
    const [ev] = cloud.of('event')
    expect(ev).toBeDefined()
    gw.onCloudMessage({ t: 'ack', tid: '111@Demo-1', seq: ev?.seq ?? -1 })
    expect(gw.status().queued).toBe(0)
    gw.onCloudClose()
    const again = fakeCloud()
    gw.onCloudOpen(again.send)
    gw.onCloudMessage(bound('111@Demo-1'))
    expect(again.of('event')).toHaveLength(0)
  })
})

describe('G-05 khởi động lại có hàng đợi', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'azgw-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('hàng đợi sống sót qua restart và gửi bù đúng một lần', () => {
    const file = path.join(dir, 'queue.json')
    const q1 = new EventQueue(file)
    const a = make(q1)
    a.gw.handlePing(ping())
    a.gw.handleEvent(eventReq({ seq: 1 }))
    q1.flush()

    const q2 = new EventQueue(file)
    expect(q2.length).toBe(1)
    const b = make(q2)
    b.gw.onCloudOpen(b.cloud.send)
    b.gw.handlePing(ping({ sid: 'S2' }))
    b.gw.onCloudMessage(bound('111@Demo-1'))
    expect(b.cloud.of('event')).toHaveLength(1)
    b.gw.onCloudMessage(bound('111@Demo-1'))
    expect(b.cloud.of('event')).toHaveLength(1)
  })

  it('file hàng đợi hỏng hoặc không có: bắt đầu rỗng, không sập', () => {
    const bad = path.join(dir, 'bad.json')
    writeFileSync(bad, '{not json')
    expect(new EventQueue(bad).length).toBe(0)
    expect(new EventQueue(path.join(dir, 'missing.json')).length).toBe(0)
    const mixed = path.join(dir, 'mixed.json')
    writeFileSync(
      mixed,
      JSON.stringify([{ nope: 1 }, { tid: 'a@b', seq: 1, reason: ['risk'], events: [] }]),
    )
    expect(new EventQueue(mixed).length).toBe(1)
  })

  it('hàng đợi đầy bỏ lô cũ nhất', () => {
    const q = new EventQueue()
    for (let i = 0; i < 1005; i++) q.push({ tid: 'a@b', seq: i, reason: ['risk'], events: [] })
    expect(q.length).toBe(1000)
    expect(q.all()[0]?.seq).toBe(5)
    expect(q.dropped).toBe(5)
  })
})

describe('G-06 bind bị từ chối', () => {
  it('reject 409: ping báo rejected + mã, không live, sự kiện bị bỏ', () => {
    const { gw, cloud } = make()
    gw.onCloudOpen(cloud.send)
    gw.handlePing(ping())
    gw.handleEvent(eventReq())
    gw.onCloudMessage({ t: 'reject', tid: '111@Demo-1', code: 409 })
    expect(gw.handlePing(ping())).toMatchObject({ bind: 'rejected', code: 409, watch: false })
    expect(gw.status().queued).toBe(0)
    expect(gw.handleEvent(eventReq({ seq: 2 }))).toEqual({ ok: true, ack_seq: 2 })
    expect(gw.status().queued).toBe(0)
  })

  it('đổi khóa thì bind lại và bỏ lô của khóa cũ', () => {
    const { gw, cloud } = make()
    gw.onCloudOpen(cloud.send)
    gw.handlePing(ping())
    gw.onCloudMessage({ t: 'reject', tid: '111@Demo-1', code: 401 })
    gw.handlePing(ping({ key: 'khoa-moi-0123456789' }))
    expect(cloud.of('bind')).toHaveLength(2)
    expect(gw.handlePing(ping({ key: 'khoa-moi-0123456789' })).bind).toBe('pending')
  })
})

describe('trạng thái online và offline', () => {
  it('im quá 20 giây: báo offline đúng một lần; ping lại: online đúng một lần', () => {
    const { gw, cloud } = make()
    gw.onCloudOpen(cloud.send)
    gw.handlePing(ping())
    gw.onCloudMessage(bound('111@Demo-1'))
    expect(cloud.of('state').map((s) => s.online)).toEqual([true])
    clock += 21_000
    gw.sweep()
    gw.sweep()
    expect(cloud.of('state').map((s) => s.online)).toEqual([true, false])
    gw.handlePing(ping())
    gw.handlePing(ping())
    expect(cloud.of('state').map((s) => s.online)).toEqual([true, false, true])
  })

  it('mất kết nối broker (conn=false) được báo như offline', () => {
    const { gw, cloud } = make()
    gw.onCloudOpen(cloud.send)
    gw.handlePing(ping())
    gw.onCloudMessage(bound('111@Demo-1'))
    gw.handlePing(ping({ conn: false }))
    expect(cloud.of('state').map((s) => s.online)).toEqual([true, false])
  })
})

describe('sự kiện EA', () => {
  it('trùng (sid, seq): ack nhưng không xếp hàng lần hai', () => {
    const { gw } = make()
    gw.handlePing(ping())
    gw.handleEvent(eventReq({ seq: 1 }))
    expect(gw.handleEvent(eventReq({ seq: 1 }))).toEqual({ ok: true, ack_seq: 1 })
    expect(gw.status().queued).toBe(1)
  })

  it('EA khởi động lại (sid mới, seq về 1) vẫn được nhận', () => {
    const { gw } = make()
    gw.handlePing(ping())
    gw.handleEvent(eventReq({ seq: 5 }))
    gw.handlePing(ping({ sid: 'S2' }))
    gw.handleEvent(eventReq({ sid: 'S2', seq: 1 }))
    expect(gw.status().queued).toBe(2)
  })

  it('sự kiện đến trước ping (Gateway mới khởi động) vẫn tạo terminal và xếp hàng', () => {
    const { gw } = make()
    expect(gw.handleEvent(eventReq())).toEqual({ ok: true, ack_seq: 1 })
    expect(gw.status().terminals).toHaveLength(1)
    expect(gw.status().queued).toBe(1)
  })

  it('seq gửi cloud đơn điệu tăng ngay cả khi đồng hồ không đổi', () => {
    const { gw, cloud } = make()
    gw.onCloudOpen(cloud.send)
    gw.handlePing(ping())
    gw.onCloudMessage(bound('111@Demo-1'))
    gw.handleEvent(eventReq({ seq: 1 }))
    gw.handleEvent(eventReq({ seq: 2 }))
    const seqs = cloud.of('event').map((e) => e.seq)
    expect(seqs[1]).toBeGreaterThan(seqs[0] ?? 0)
  })
})

describe('trạng thái không lộ khóa', () => {
  it('status() không chứa API key', () => {
    const { gw } = make()
    gw.handlePing(ping())
    expect(JSON.stringify(gw.status())).not.toContain('test-key')
  })
})

describe('theo tick cho terminal xem riêng (trang /links/:id)', () => {
  const TID = '111@Demo-1'

  function ready(watch: { tids: string[]; fast?: string[] }) {
    const { gw, cloud } = make()
    gw.onCloudOpen(cloud.send)
    gw.handlePing(ping())
    gw.onCloudMessage(bound(TID))
    gw.onCloudMessage({ t: 'watch', push_sec: 1, ...watch })
    return { gw, cloud }
  }
  const send = (gw: Gateway, seq: number, over: Parameters<typeof samplesReq>[0] = {}) =>
    gw.handleSamples(
      samplesReq({
        seq,
        // Giá trị đổi theo seq: mẫu trùng hệt bị Gateway bỏ (xem nhóm "mẫu trùng").
        samples: [{ ...sample(1_760_000_000 + seq), eq: 1000 + seq }],
        ...over,
      }),
    )

  it('interval_ms theo terminal: xem riêng 250 ms, chỉ trong danh sách 1000 ms', () => {
    const { gw } = ready({ tids: [TID], fast: [TID] })
    expect(gw.handlePing(ping()).interval_ms).toBe(GW.fastIntervalMs)
    gw.onCloudMessage({ t: 'watch', tids: [TID], push_sec: 1 })
    expect(gw.handlePing(ping()).interval_ms).toBe(1000)
    gw.onCloudMessage({ t: 'watch', tids: [TID], fast: [TID], push_sec: 1 })
    expect(gw.handlePing(ping()).interval_ms).toBe(GW.fastIntervalMs)
  })

  it('xem riêng: mỗi 250 ms một batch; không chờ đủ 1 giây', () => {
    const { gw, cloud } = ready({ tids: [TID], fast: [TID] })
    for (let i = 1; i <= 4; i++) {
      send(gw, i)
      gw.flush()
      clock += GW.fastPushMs
    }
    expect(cloud.of('batch')).toHaveLength(4)
  })

  it('chỉ trong danh sách: tối đa mỗi giây một batch dù EA gửi nhanh hơn', () => {
    const { gw, cloud } = ready({ tids: [TID] })
    for (let i = 1; i <= 8; i++) {
      send(gw, i)
      gw.flush()
      clock += GW.fastPushMs // 8 lần x 250 ms = 2 giây
    }
    expect(cloud.of('batch')).toHaveLength(2)
  })

  it('mẫu giữa hai nhịp không mất: gom vào batch kế tiếp', () => {
    const { gw, cloud } = ready({ tids: [TID] })
    send(gw, 1)
    gw.flush() // batch 1
    clock += 300
    send(gw, 2)
    gw.flush() // chưa tới nhịp 1 giây: giữ lại
    expect(cloud.of('batch')).toHaveLength(1)
    clock += 800
    gw.flush()
    const batches = cloud.of('batch')
    expect(batches).toHaveLength(2)
    expect(batches[1]?.items[0]?.samples.map((s) => s.t)).toEqual([1_760_000_002])
  })

  it('pl chỉ đi lên cloud với terminal xem riêng', () => {
    const fast = ready({ tids: [TID], fast: [TID] })
    send(fast.gw, 1, { pl: { '4016996233': 4.92 } })
    fast.gw.flush()
    expect(fast.cloud.of('batch')[0]?.items[0]?.pl).toEqual({ '4016996233': 4.92 })

    const list = ready({ tids: [TID] })
    send(list.gw, 1, { pl: { '4016996233': 4.92 } })
    list.gw.flush()
    expect(list.cloud.of('batch')[0]?.items[0]?.pl).toBeUndefined()
  })

  it('positions đầy đủ thay pl; pl không bị gửi lặp ở batch sau', () => {
    const { gw, cloud } = ready({ tids: [TID], fast: [TID] })
    const positions = [
      { ticket: 7, symbol: 'XAUUSDm', type: 'sell' as const, volume: 0.01, time: 1, price: 4120.8 },
    ]
    send(gw, 1, { positions, pos_hash: 'h1', pl: { '7': 1 } })
    gw.flush()
    const first = cloud.of('batch')[0]?.items[0]
    expect(first?.positions).toHaveLength(1)
    expect(first?.pl).toBeUndefined()

    clock += GW.fastPushMs
    send(gw, 2, { pl: { '7': 2 } })
    gw.flush()
    clock += GW.fastPushMs
    send(gw, 3) // không pl
    gw.flush()
    const batches = cloud.of('batch')
    expect(batches[1]?.items[0]?.pl).toEqual({ '7': 2 })
    expect(batches[2]?.items[0]?.pl).toBeUndefined()
  })

  it('watch rỗng hoặc mất cloud thì không còn terminal nào theo tick', () => {
    const { gw, cloud } = ready({ tids: [TID], fast: [TID] })
    expect(gw.status().fast).toBe(1)
    gw.onCloudMessage({ t: 'watch', tids: [], push_sec: 1 })
    expect(gw.status().fast).toBe(0)
    gw.onCloudMessage({ t: 'watch', tids: [TID], fast: [TID], push_sec: 1 })
    gw.onCloudClose()
    expect(gw.status().fast).toBe(0)
    send(gw, 9)
    gw.flush()
    expect(cloud.of('batch')).toHaveLength(0)
  })

  it('fast chỉ có nghĩa với terminal đang được watch', () => {
    const { gw } = ready({ tids: [], fast: [TID] })
    expect(gw.status().fast).toBe(0)
    expect(gw.handlePing(ping()).interval_ms).toBe(1000)
  })
})

describe('phiên bản EA lên cloud', () => {
  const TID = '111@Demo-1'

  it('bind và state mang ea_ver từ ping', () => {
    const { gw, cloud } = make()
    gw.onCloudOpen(cloud.send)
    gw.handlePing(ping({ ea_ver: '0.3.0' }))
    expect(cloud.of('bind')[0]).toMatchObject({ tid: TID, ea_ver: '0.3.0' })
    gw.onCloudMessage(bound(TID))
    expect(cloud.of('state')[0]).toMatchObject({ tid: TID, online: true, ea_ver: '0.3.0' })
  })

  it('EA đổi phiên bản (biên dịch lại): báo lại state với ea_ver mới, không báo lặp khi không đổi', () => {
    const { gw, cloud } = make()
    gw.onCloudOpen(cloud.send)
    gw.handlePing(ping({ ea_ver: '0.2.0' }))
    gw.onCloudMessage(bound(TID))
    gw.handlePing(ping({ ea_ver: '0.2.0' }))
    expect(cloud.of('state')).toHaveLength(1)
    gw.handlePing(ping({ ea_ver: '0.3.0' }))
    const states = cloud.of('state')
    expect(states).toHaveLength(2)
    expect(states[1]).toMatchObject({ online: true, ea_ver: '0.3.0' })
  })
})

describe('Plan 3D: không ai xem thì event được giữ lại', () => {
  const TID = '111@Demo-1'
  const IDLE = 1800

  /** Gateway dùng nhịp giữ mặc định (idleFlushSec > 0), cloud đã nối và terminal đã bind. */
  function idleGateway() {
    const gw = new Gateway({ now, idleFlushSec: IDLE })
    const cloud = fakeCloud()
    gw.onCloudOpen(cloud.send)
    gw.handlePing(ping())
    gw.onCloudMessage(bound(TID))
    return { gw, cloud }
  }

  it('bind và state đi ngay; event chờ', () => {
    const { gw, cloud } = idleGateway()
    gw.handleEvent(eventReq({ seq: 1 }))
    gw.sweep()
    expect(cloud.of('bind')).toHaveLength(1)
    expect(cloud.of('state')).toHaveLength(1)
    expect(cloud.of('event')).toHaveLength(0)
  })

  it('đổi online/offline vẫn báo ngay dù không ai xem (danh sách web cần)', () => {
    const { gw, cloud } = idleGateway()
    clock += (GW.offlineAfterSec + 1) * 1000
    gw.sweep()
    expect(cloud.of('state').map((m) => m.online)).toEqual([true, false])
  })

  it('có người bắt đầu xem: event đã giữ đi ngay', () => {
    const { gw, cloud } = idleGateway()
    gw.handleEvent(eventReq({ seq: 1 }))
    gw.onCloudMessage({ t: 'watch', tids: [TID], push_sec: 1 })
    expect(cloud.of('event')).toHaveLength(1)
  })

  it('đủ idleFlushSec thì đẩy gộp một lần rồi lại giữ', () => {
    const { gw, cloud } = idleGateway()
    gw.handleEvent(eventReq({ seq: 1 }))
    clock += IDLE * 1000 - 1000
    gw.sweep()
    expect(cloud.of('event')).toHaveLength(0)
    clock += 1000
    gw.sweep()
    expect(cloud.of('event')).toHaveLength(1)
    gw.handleEvent(eventReq({ seq: 2 }))
    clock += 5000
    gw.sweep()
    expect(cloud.of('event')).toHaveLength(1)
  })

  it('hàng đợi đạt ngưỡng thì đẩy sớm, không chờ hết idleFlushSec', () => {
    const { gw, cloud } = idleGateway()
    for (let seq = 1; seq <= GW.idleFlushQueue; seq++) gw.handleEvent(eventReq({ seq }))
    expect(cloud.of('event').length).toBeGreaterThan(0)
  })

  it('idleFlushSec = 0: gửi ngay như trước', () => {
    const gw = new Gateway({ now, idleFlushSec: 0 })
    const cloud = fakeCloud()
    gw.onCloudOpen(cloud.send)
    gw.handlePing(ping())
    gw.onCloudMessage(bound(TID))
    gw.handleEvent(eventReq({ seq: 1 }))
    expect(cloud.of('event')).toHaveLength(1)
  })
})

describe('Plan 3D: mẫu trùng không đẩy lại, có nhịp giữ sống', () => {
  const TID = '111@Demo-1'

  function ready(fast = false) {
    const { gw, cloud } = make()
    gw.onCloudOpen(cloud.send)
    gw.handlePing(ping())
    gw.onCloudMessage(bound(TID))
    gw.onCloudMessage({ t: 'watch', tids: [TID], ...(fast ? { fast: [TID] } : {}), push_sec: 1 })
    return { gw, cloud }
  }
  let seq = 0
  const feed = (gw: Gateway, eq = 1010.5) =>
    gw.handleSamples(samplesReq({ seq: ++seq, samples: [{ ...sample(1_760_000_000 + seq), eq }] }))

  beforeEach(() => {
    seq = 0
  })

  it('giá trị không đổi: chỉ mẫu đầu và mẫu giữ sống mỗi keepAliveMs', () => {
    const { gw, cloud } = ready()
    for (let i = 0; i < 20; i++) {
      feed(gw)
      gw.flush()
      clock += 1000
    }
    // 20 giây: mẫu đầu + giữ sống ở giây 5, 10, 15 (không phải 20 batch).
    expect(cloud.of('batch')).toHaveLength(4)
  })

  it('giá trị đổi thì đi ngay ở nhịp kế tiếp', () => {
    const { gw, cloud } = ready()
    feed(gw)
    gw.flush()
    clock += 1000
    feed(gw)
    gw.flush()
    expect(cloud.of('batch')).toHaveLength(1)
    clock += 1000
    feed(gw, 1011)
    gw.flush()
    expect(cloud.of('batch')).toHaveLength(2)
  })

  it('xem riêng: lãi/lỗ không đổi cũng không đẩy lại', () => {
    const { gw, cloud } = ready(true)
    const pl = { '77': 1.5 }
    for (let i = 0; i < 6; i++) {
      gw.handleSamples(samplesReq({ seq: ++seq, samples: [sample(1_760_000_000 + seq)], pl }))
      gw.flush()
      clock += GW.fastPushMs
    }
    expect(cloud.of('batch')).toHaveLength(1)
    gw.handleSamples(samplesReq({ seq: ++seq, samples: [sample(1_760_000_100)], pl: { '77': 2 } }))
    gw.flush()
    expect(cloud.of('batch')).toHaveLength(2)
  })

  it('người xem mới (watch đổi): mẫu đầu đi ngay dù trùng', () => {
    const { gw, cloud } = ready()
    feed(gw)
    gw.flush()
    gw.onCloudMessage({ t: 'watch', tids: [], push_sec: 1 })
    gw.onCloudMessage({ t: 'watch', tids: [TID], push_sec: 1 })
    clock += 1000
    feed(gw)
    gw.flush()
    expect(cloud.of('batch')).toHaveLength(2)
  })
})
