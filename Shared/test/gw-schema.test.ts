import { describe, expect, it } from 'vitest'
import {
  clampIntervalMs,
  clampPushSec,
  eventRequestSchema,
  GW,
  gwClientMessageSchema,
  gwServerMessageSchema,
  pingRequestSchema,
  samplesRequestSchema,
  terminalId,
} from '../src'

const ident = { v: 1, sid: 'AB12', key: 'k'.repeat(20), login: 123456, server: 'Exness-Demo' }
const snap = { bal: 1000, eq: 1010.5, fl: 10.5, ml: null }
const sample = { t: 1_760_000_000, eq: 1010.5, bal: 1000, fl: 10.5, ml: null }

describe('pingRequestSchema', () => {
  it('chấp nhận ping tối thiểu và điền mặc định', () => {
    const r = pingRequestSchema.parse({ ...ident, snap })
    expect(r.conn).toBe(true)
    expect(r.mode).toBe('real')
  })

  it.each([
    ['thiếu key', { ...ident, key: '', snap }],
    ['login âm', { ...ident, login: -1, snap }],
    ['server rỗng', { ...ident, server: '', snap }],
    ['thiếu snap', { ...ident }],
    ['v sai', { ...ident, v: 2, snap }],
    ['equity NaN', { ...ident, snap: { ...snap, eq: Number.NaN } }],
  ])('từ chối %s', (_n, body) => {
    expect(pingRequestSchema.safeParse(body).success).toBe(false)
  })
})

describe('samplesRequestSchema', () => {
  it('chấp nhận 1 đến 20 mẫu, từ chối rỗng hoặc 21 mẫu', () => {
    expect(samplesRequestSchema.safeParse({ ...ident, seq: 1, samples: [sample] }).success).toBe(
      true,
    )
    expect(samplesRequestSchema.safeParse({ ...ident, seq: 1, samples: [] }).success).toBe(false)
    expect(
      samplesRequestSchema.safeParse({ ...ident, seq: 1, samples: Array(21).fill(sample) }).success,
    ).toBe(false)
  })
})

describe('eventRequestSchema', () => {
  const close = { kind: 'close', deal_ticket: 9, position_id: 7, time: 1_760_000_000, profit: 3 }

  it('chấp nhận sự kiện đóng lệnh', () => {
    expect(
      eventRequestSchema.safeParse({ ...ident, seq: 1, reason: ['trade_event'], events: [close] })
        .success,
    ).toBe(true)
  })

  it('chấp nhận cảnh báo margin không có sự kiện lệnh', () => {
    const r = eventRequestSchema.parse({ ...ident, seq: 2, reason: ['risk'], snap })
    expect(r.events).toEqual([])
  })

  it('từ chối reason rỗng hoặc ngoài danh sách', () => {
    expect(eventRequestSchema.safeParse({ ...ident, seq: 1, reason: [] }).success).toBe(false)
    expect(eventRequestSchema.safeParse({ ...ident, seq: 1, reason: ['x'] }).success).toBe(false)
  })
})

describe('tin WebSocket', () => {
  it('gateway -> cloud: hello, bind, state, batch, event', () => {
    const tid = terminalId(123456, 'Exness-Demo')
    expect(tid).toBe('123456@Exness-Demo')
    const msgs = [
      { t: 'hello', v: 1, gw_ver: '0.1.0' },
      { t: 'bind', tid, key: 'k', login: 123456, server: 'Exness-Demo', mode: 'demo' },
      { t: 'state', tid, online: true, snap },
      { t: 'batch', items: [{ tid, samples: [sample] }] },
      { t: 'event', tid, seq: 1, reason: ['trade_event'], events: [] },
    ]
    for (const m of msgs) expect(gwClientMessageSchema.safeParse(m).success).toBe(true)
  })

  it('từ chối batch không có phần tử', () => {
    expect(gwClientMessageSchema.safeParse({ t: 'batch', items: [] }).success).toBe(false)
  })

  it('cloud -> gateway: bound, reject, watch, ack, update', () => {
    const tid = '1@S'
    const msgs = [
      { t: 'bound', tid, link_id: 5 },
      { t: 'reject', tid, code: 401 },
      { t: 'watch', tids: [tid], push_sec: 2 },
      { t: 'watch', tids: [], push_sec: 2 },
      { t: 'ack', tid, seq: 3 },
      { t: 'update', min_ver: '0.2.0', url: 'https://x/y.exe', sha256: 'a'.repeat(64) },
    ]
    for (const m of msgs) expect(gwServerMessageSchema.safeParse(m).success).toBe(true)
    expect(
      gwServerMessageSchema.safeParse({ t: 'update', min_ver: '1', url: 'u', sha256: 'zz' })
        .success,
    ).toBe(false)
    expect(gwServerMessageSchema.safeParse({ t: 'lạ' }).success).toBe(false)
  })
})

describe('kẹp tham số', () => {
  it('push_sec kẹp vào [1, 5], rác dùng mặc định', () => {
    expect(clampPushSec(0)).toBe(1)
    expect(clampPushSec(99)).toBe(5)
    expect(clampPushSec('x')).toBe(GW.defaultPushSec)
  })

  it('interval_ms kẹp vào [1000, 5000], rác dùng mặc định', () => {
    expect(clampIntervalMs(10)).toBe(1000)
    expect(clampIntervalMs(99_999)).toBe(5000)
    expect(clampIntervalMs(Number.NaN)).toBe(GW.defaultIntervalMs)
  })
})
