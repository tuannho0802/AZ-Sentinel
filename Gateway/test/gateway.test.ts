import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Gateway } from '../src/gateway'
import { EventQueue } from '../src/queue'
import { bound, eventReq, fakeCloud, ping, samplesReq } from './helpers'

let clock = 1_000_000
const now = () => clock

function make(queue?: EventQueue) {
  const gw = new Gateway({ now, queue })
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
