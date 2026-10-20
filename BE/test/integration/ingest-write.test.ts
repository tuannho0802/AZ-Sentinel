import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import { count, makePayload, post, resetDb, seedLink, tradeEvent } from '../helpers'

beforeEach(resetDb)

type Meta = { rows_written: number; rows_read: number }
const send = async (key: string, body: unknown) => {
  const res = await post(key, body)
  return { res, json: (await res.json()) as { ack_seq: number; duplicate?: boolean; meta?: Meta } }
}

describe('ingest: số dòng ghi (chặn hồi quy ghi thừa, Plan 3 P1-18)', () => {
  it('heartbeat ghi đúng 1 dòng', async () => {
    const { key } = await seedLink()
    const { json } = await send(key, makePayload({ reason: ['heartbeat'] }))
    expect(json.meta?.rows_written).toBe(1)
  })

  it('m5_bar ghi đúng 2 dòng', async () => {
    const { key } = await seedLink()
    const { json } = await send(key, makePayload({ reason: ['m5_bar'] }))
    expect(json.meta?.rows_written).toBe(2)
  })

  it('m5_bar kèm 1 sự kiện đóng lệnh ghi đúng 3 dòng', async () => {
    const { key } = await seedLink()
    const events = [tradeEvent({ kind: 'close', deal_ticket: 2, profit: 12.5 })]
    const { json } = await send(key, makePayload({ reason: ['m5_bar', 'trade_event'], events }))
    expect(json.meta?.rows_written).toBe(3)
  })

  it('gửi trùng seq ghi 0 dòng và trả duplicate với ack_seq cũ', async () => {
    const { key } = await seedLink()
    const payload = makePayload({ reason: ['m5_bar'] })
    const first = await send(key, payload)
    const again = await send(key, payload)
    expect(again.res.status).toBe(200)
    expect(again.json.duplicate).toBe(true)
    expect(again.json.ack_seq).toBe(first.json.ack_seq)
    expect(again.json.meta).toBeUndefined()
  })

  it('không đổi dữ liệu khi gửi trùng (idempotent)', async () => {
    const { key } = await seedLink()
    const payload = makePayload({ reason: ['m5_bar'], events: [tradeEvent({})] })
    await send(key, payload)
    const before = await env.DB.prepare('SELECT * FROM link_state').first()
    await send(key, payload)
    expect(await env.DB.prepare('SELECT * FROM link_state').first()).toEqual(before)
    expect(await count('equity_m5')).toBe(1)
    expect(await count('trades')).toBe(1)
  })

  it('EA khởi động lại (sid mới, seq nhỏ) vẫn được ghi', async () => {
    const { key } = await seedLink()
    await send(key, makePayload({ sid: 'aaa111', seq: 500 }))
    const { json } = await send(key, makePayload({ sid: 'bbb222', seq: 1 }))
    expect(json.duplicate).toBeUndefined()
    expect(json.ack_seq).toBe(1)
    const row = await env.DB.prepare('SELECT last_sid, last_seq FROM link_state').first()
    expect(row).toEqual({ last_sid: 'bbb222', last_seq: 1 })
  })

  it('không phản hồi meta khi tắt chế độ debug', async () => {
    const { key } = await seedLink()
    const { exports } = await import('cloudflare:workers')
    const original = env.INGEST_DEBUG_META
    env.INGEST_DEBUG_META = '0'
    try {
      const res = await exports.default.fetch(
        new Request('http://az.test/api/ea/v1/ingest', {
          method: 'POST',
          headers: { 'X-API-Key': key, 'Content-Type': 'application/json' },
          body: JSON.stringify(makePayload()),
        }),
      )
      expect(((await res.json()) as { meta?: Meta }).meta).toBeUndefined()
    } finally {
      env.INGEST_DEBUG_META = original
    }
  })
})

describe('ingest: nội dung được lưu', () => {
  it('last_seen_at dùng giờ server, không dùng ts_utc của EA', async () => {
    const { key } = await seedLink()
    await send(key, makePayload({ ts_utc: 1000 }))
    const row = await env.DB.prepare('SELECT last_seen_at FROM link_state').first<{
      last_seen_at: number
    }>()
    expect(Math.abs((row?.last_seen_at ?? 0) - Math.floor(Date.now() / 1000))).toBeLessThan(10)
  })

  it('chuẩn hóa nhãn VPS (viết hoa, bỏ ký tự lạ)', async () => {
    const { key } = await seedLink()
    await send(key, makePayload({ vps: '  vps a<12>!  ' }))
    const row = await env.DB.prepare('SELECT vps_label FROM link_state').first()
    expect(row).toEqual({ vps_label: 'VPSA12' })
  })

  it('lưu số liệu tài khoản và danh sách lệnh đang mở dạng JSON', async () => {
    const { key } = await seedLink()
    const positions = [
      { ticket: 1, symbol: 'XAUUSD', type: 'buy', volume: 0.1, time: 1, price: 4000, profit: 3 },
    ]
    await send(key, makePayload({ positions }))
    const row = await env.DB.prepare(
      'SELECT equity, floating_pl, positions_json FROM link_state',
    ).first<{ equity: number; floating_pl: number; positions_json: string }>()
    expect(row?.equity).toBe(10050.5)
    expect(JSON.parse(row?.positions_json ?? '[]')).toEqual(positions)
  })

  it('equity_m5 chỉ có một dòng cho mỗi nến M5 dù gửi nhiều lần', async () => {
    const { key } = await seedLink()
    // Căn về đầu nến M5 để ts và ts + 10 luôn cùng một nến (tránh test chập chờn
    // khi chạy sát ranh giới 5 phút).
    const ts = Math.floor(Date.now() / 1000 / 300) * 300
    await send(key, makePayload({ reason: ['m5_bar'], ts_utc: ts }))
    await send(key, makePayload({ reason: ['m5_bar'], ts_utc: ts + 10 }))
    expect(await count('equity_m5')).toBe(1)
  })

  it('comment chứa SQL, <script> và ký tự đặc biệt được lưu nguyên văn, không phá DB', async () => {
    const { key } = await seedLink()
    const evil = `'); DROP TABLE trades; -- <script>alert("x")</script> \\ "nháy" Lệnh thử`
    const events = [tradeEvent({ comment: evil })]
    const { res } = await send(key, makePayload({ reason: ['trade_event'], events }))
    expect(res.status).toBe(200)
    const row = await env.DB.prepare('SELECT comment FROM trades').first()
    expect(row).toEqual({ comment: evil })
    expect(await count('trades')).toBe(1)
  })
})

describe('ingest: trạng thái online/offline', () => {
  it('khi đang offline, ingest chuyển về online và ghi đúng một sự kiện online', async () => {
    const { key, id } = await seedLink()
    await send(key, makePayload())
    await env.DB.prepare('UPDATE link_state SET presence = 1 WHERE link_id = ?').bind(id).run()
    await send(key, makePayload())
    const state = await env.DB.prepare('SELECT presence FROM link_state').first()
    expect(state).toEqual({ presence: 0 })
    expect(await count('events', "type = 'online'")).toBe(1)
    await send(key, makePayload())
    expect(await count('events', "type = 'online'")).toBe(1)
  })
})

describe('ingest: bảng trades (upsert theo position)', () => {
  it('mở rồi đóng lệnh gộp thành một dòng đầy đủ', async () => {
    const { key } = await seedLink()
    await send(key, makePayload({ reason: ['trade_event'], events: [tradeEvent({})] }))
    const close = tradeEvent({
      kind: 'close',
      deal_ticket: 2,
      time: 1792499900,
      price: 4020.5,
      profit: 10.38,
      swap: -0.2,
      commission: -0.7,
    })
    await send(key, makePayload({ reason: ['trade_event'], events: [close] }))
    expect(await count('trades')).toBe(1)
    const t = await env.DB.prepare('SELECT * FROM trades').first()
    expect(t).toMatchObject({
      ticket: 5001,
      symbol: 'XAUUSD',
      type: 'buy',
      open_time: 1792499000,
      open_price: 4010.12,
      close_time: 1792499900,
      close_price: 4020.5,
      profit: 10.38,
    })
  })

  it('sự kiện đóng đến trước sự kiện mở vẫn cho kết quả đúng', async () => {
    const { key } = await seedLink()
    const close = tradeEvent({
      kind: 'close',
      deal_ticket: 2,
      time: 1792499900,
      price: 4020.5,
      profit: 9,
    })
    await send(key, makePayload({ events: [close] }))
    await send(key, makePayload({ events: [tradeEvent({})] }))
    const t = await env.DB.prepare('SELECT * FROM trades').first()
    expect(await count('trades')).toBe(1)
    expect(t).toMatchObject({ open_price: 4010.12, close_price: 4020.5, profit: 9 })
  })

  it('gửi lại sự kiện mở sau khi đã đóng không xóa dữ liệu đóng lệnh', async () => {
    const { key } = await seedLink()
    const open = tradeEvent({})
    const close = tradeEvent({
      kind: 'close',
      deal_ticket: 2,
      time: 1792499900,
      price: 4020.5,
      profit: 9,
    })
    await send(key, makePayload({ events: [open, close] }))
    await send(key, makePayload({ events: [open] }))
    const t = await env.DB.prepare('SELECT close_time, profit FROM trades').first()
    expect(t).toEqual({ close_time: 1792499900, profit: 9 })
  })

  it('sự kiện modify cập nhật SL/TP, không làm mất giá mở lệnh', async () => {
    const { key } = await seedLink()
    await send(key, makePayload({ events: [tradeEvent({ sl: 4000, tp: 4030 })] }))
    await send(
      key,
      makePayload({ events: [tradeEvent({ kind: 'modify', deal_ticket: 3, sl: 4005, tp: 4040 })] }),
    )
    const t = await env.DB.prepare('SELECT open_price, sl, tp FROM trades').first()
    expect(t).toEqual({ open_price: 4010.12, sl: 4005, tp: 4040 })
  })

  it('hai liên kết có cùng ticket không ghi đè nhau', async () => {
    const a = await seedLink({ login: 111 })
    const b = await seedLink({ login: 222 })
    const mk = (login: number) =>
      makePayload({
        account: { ...makePayload().account, login },
        events: [tradeEvent({})],
      })
    await send(a.key, mk(111))
    await send(b.key, mk(222))
    expect(await count('trades')).toBe(2)
  })
})
