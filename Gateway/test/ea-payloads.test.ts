import { eventRequestSchema, pingRequestSchema, samplesRequestSchema } from '@az-sentinel/shared'
import { describe, expect, it } from 'vitest'

/**
 * Chuỗi JSON dưới đây được CHÉP TAY đúng định dạng mà `ea/AZ_Spike.mq5` sinh ra (thứ tự trường,
 * số 2 chữ số thập phân cho tiền, `null` cho sl/tp bằng 0, bỏ số 0 thừa ở giá). Đây là test hợp
 * đồng, không phải đầu ra thật từ MT5: A-01 đến A-07 trên terminal demo vẫn phải chạy.
 * Khi đổi định dạng trong EA, đổi cả ở đây.
 */
const ident =
  '"v":1,"sid":"1A2B3C4D","key":"abcdefghijklmnopqrstuvwxyz","login":87654321,"server":"Exness-MT5Trial9"'
const snap = '{"bal":10250.40,"eq":10311.15,"margin":120.50,"fl":60.75,"ml":8557.51}'

describe('payload EA sinh ra', () => {
  it('ping', () => {
    const body = `{${ident},"ea_ver":"0.2.0","mode":"demo","broker":"Exness Technologies Ltd","name":"Nguyễn \\"Văn\\" A","conn":true,"snap":${snap}}`
    const r = pingRequestSchema.parse(JSON.parse(body))
    expect(r.name).toBe('Nguyễn "Văn" A')
    expect(r.snap.ml).toBe(8557.51)
  })

  it('ping khi chưa có lệnh: ml là null', () => {
    const body = `{${ident},"ea_ver":"0.2.0","mode":"real","broker":"","name":"","conn":false,"snap":{"bal":100.00,"eq":100.00,"margin":0.00,"fl":0.00,"ml":null}}`
    const r = pingRequestSchema.parse(JSON.parse(body))
    expect(r.conn).toBe(false)
    expect(r.snap.ml).toBeNull()
  })

  it('samples lần đầu của đợt live: có positions, pos_hash, total_positions', () => {
    const body = `{${ident},"seq":1,"samples":[{"t":1760000000,"eq":10311.15,"bal":10250.40,"fl":60.75,"ml":8557.51},{"t":1760000001,"eq":10311.20,"bal":10250.40,"fl":60.80,"ml":null}],"positions":[{"ticket":998877,"symbol":"XAUUSD","type":"buy","volume":0.1,"time":1759999000,"price":4010.12,"sl":4000,"tp":null,"profit":22.40,"swap":-0.50,"comment":"az-bot","magic":20260101},{"ticket":998878,"symbol":"EURUSD","type":"sell","volume":0.01,"time":1759999100,"price":1.16543,"sl":null,"tp":null,"profit":-0.00,"swap":0.00,"comment":"","magic":0}],"pos_hash":"1a2b3c4d5e6f7788","total_positions":2}`
    const r = samplesRequestSchema.parse(JSON.parse(body))
    expect(r.positions).toHaveLength(2)
    expect(r.positions?.[0]?.tp).toBeNull()
    expect(r.samples[1]?.ml).toBeNull()
  })

  it('samples không đổi vị thế: không có positions', () => {
    const body = `{${ident},"seq":2,"samples":[{"t":1760000002,"eq":1.00,"bal":1.00,"fl":0.00,"ml":null}]}`
    expect(samplesRequestSchema.parse(JSON.parse(body)).positions).toBeUndefined()
  })

  it('samples có positions bị cắt ở 200', () => {
    const body = `{${ident},"seq":3,"samples":[{"t":1,"eq":1.00,"bal":1.00,"fl":0.00,"ml":null}],"positions":[],"pos_hash":"ff","total_positions":350,"truncated":true}`
    const r = samplesRequestSchema.parse(JSON.parse(body))
    expect(r.truncated).toBe(true)
  })

  it('event mở lệnh', () => {
    const body = `{${ident},"seq":1,"reason":["trade_event"],"events":[{"kind":"open","deal_ticket":5551234,"position_id":998877,"symbol":"XAUUSD","type":"buy","volume":0.1,"time":1759999000,"price":4010.12,"sl":4000,"tp":null,"comment":"az-bot","magic":20260101}],"snap":${snap}}`
    const r = eventRequestSchema.parse(JSON.parse(body))
    expect(r.events[0]?.kind).toBe('open')
    expect(r.events[0]?.tp).toBeNull()
  })

  it('event đóng lệnh có profit, swap, commission', () => {
    const body = `{${ident},"seq":2,"reason":["trade_event"],"events":[{"kind":"close","deal_ticket":5551300,"position_id":998877,"symbol":"XAUUSD","type":"buy","volume":0.1,"time":1760003000,"price":4030,"sl":null,"tp":null,"profit":199.80,"swap":-0.50,"commission":-0.70,"comment":"[tp 4030.00]","magic":20260101}],"snap":${snap}}`
    expect(eventRequestSchema.parse(JSON.parse(body)).events[0]?.commission).toBe(-0.7)
  })

  it('event sửa SL/TP: deal_ticket 0, không có price', () => {
    const body = `{${ident},"seq":3,"reason":["trade_event"],"events":[{"kind":"modify","deal_ticket":0,"position_id":998877,"symbol":"XAUUSD","type":"buy","volume":0.1,"time":1760001000,"sl":4005.5,"tp":4040}],"snap":${snap}}`
    expect(eventRequestSchema.parse(JSON.parse(body)).events[0]?.kind).toBe('modify')
  })

  it('event nạp tiền (không có lệnh) và cảnh báo margin', () => {
    const deposit = `{${ident},"seq":4,"reason":["trade_event"],"events":[],"snap":${snap}}`
    const risk = `{${ident},"seq":5,"reason":["trade_event","risk"],"events":[],"snap":${snap}}`
    expect(eventRequestSchema.safeParse(JSON.parse(deposit)).success).toBe(true)
    expect(eventRequestSchema.parse(JSON.parse(risk)).reason).toEqual(['trade_event', 'risk'])
  })

  it('"-0" mà DoubleToString có thể sinh ra vẫn là số hợp lệ', () => {
    const body = `{${ident},"seq":6,"samples":[{"t":1,"eq":1.00,"bal":1.00,"fl":-0.00,"ml":null}]}`
    expect(samplesRequestSchema.safeParse(JSON.parse(body)).success).toBe(true)
  })
})

describe('EA phân tích phản hồi Gateway bằng tìm chuỗi', () => {
  // Bản sao logic JsonBool/JsonInt/JsonStr của EA: giữ nguyên phép tính vị trí để bắt lệch offset.
  const find = (s: string, key: string) => s.indexOf(`"${key}":`)
  const jsonBool = (s: string, key: string) => {
    const p = find(s, key)
    return p < 0 ? null : s.substr(p + key.length + 3, 4) === 'true'
  }
  const jsonInt = (s: string, key: string) => {
    const p = find(s, key)
    if (p < 0) return null
    const m = /^-?\d+/.exec(s.slice(p + key.length + 3))
    return m ? Number(m[0]) : null
  }
  const jsonStr = (s: string, key: string) => {
    const p = s.indexOf(`"${key}":"`)
    if (p < 0) return ''
    const start = p + key.length + 4
    return s.slice(start, s.indexOf('"', start))
  }

  const reply = '{"ok":true,"bind":"ok","code":0,"watch":true,"interval_ms":2000,"lease_ms":15000}'

  it('đọc đúng watch, interval_ms, lease_ms, bind, code từ phản hồi thật của Gateway', () => {
    expect(jsonBool(reply, 'watch')).toBe(true)
    expect(jsonInt(reply, 'interval_ms')).toBe(2000)
    expect(jsonInt(reply, 'lease_ms')).toBe(15000)
    expect(jsonInt(reply, 'code')).toBe(0)
    expect(jsonStr(reply, 'bind')).toBe('ok')
  })

  it('watch:false và bind rejected với mã 409', () => {
    const r =
      '{"ok":true,"bind":"rejected","code":409,"watch":false,"interval_ms":1000,"lease_ms":15000}'
    expect(jsonBool(r, 'watch')).toBe(false)
    expect(jsonStr(r, 'bind')).toBe('rejected')
    expect(jsonInt(r, 'code')).toBe(409)
  })

  it('ack_seq của /v1/event', () => {
    expect(jsonInt('{"ok":true,"ack_seq":12}', 'ack_seq')).toBe(12)
  })
})
