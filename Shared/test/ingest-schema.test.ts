import { describe, expect, it } from 'vitest'
import { ingestPayloadSchema } from '../src/ingest-schema'
import { validPayload as valid } from './fixtures'

const firstPosition = () => {
  const p = valid.positions[0]
  if (!p) throw new Error('fixture thiếu vị thế')
  return p
}

describe('ingestPayloadSchema', () => {
  it('chấp nhận payload mẫu trong Plan 1', () => {
    expect(ingestPayloadSchema.safeParse(valid).success).toBe(true)
  })

  it('events mặc định rỗng; positions vắng mặt giữ nguyên là vắng mặt ("không đổi")', () => {
    const { positions: _p, events: _e, ...rest } = valid
    const parsed = ingestPayloadSchema.parse(rest)
    expect(parsed.positions).toBeUndefined()
    expect(parsed.events).toEqual([])
  })

  it('từ chối phiên bản schema khác 1', () => {
    expect(ingestPayloadSchema.safeParse({ ...valid, v: 2 }).success).toBe(false)
  })

  it('từ chối reason rỗng hoặc không hợp lệ', () => {
    expect(ingestPayloadSchema.safeParse({ ...valid, reason: [] }).success).toBe(false)
    expect(ingestPayloadSchema.safeParse({ ...valid, reason: ['hack'] }).success).toBe(false)
  })

  it('từ chối số không hữu hạn (Infinity)', () => {
    const bad = { ...valid, account: { ...valid.account, equity: Number.POSITIVE_INFINITY } }
    expect(ingestPayloadSchema.safeParse(bad).success).toBe(false)
  })

  it('từ chối login không dương', () => {
    const bad = { ...valid, account: { ...valid.account, login: 0 } }
    expect(ingestPayloadSchema.safeParse(bad).success).toBe(false)
  })

  it('từ chối server rỗng', () => {
    const bad = { ...valid, account: { ...valid.account, server: '' } }
    expect(ingestPayloadSchema.safeParse(bad).success).toBe(false)
  })

  it('từ chối quá 200 vị thế', () => {
    const many = Array.from({ length: 201 }, () => firstPosition())
    expect(ingestPayloadSchema.safeParse({ ...valid, positions: many }).success).toBe(false)
  })

  it('từ chối comment quá dài', () => {
    const position = { ...firstPosition(), comment: 'x'.repeat(129) }
    expect(ingestPayloadSchema.safeParse({ ...valid, positions: [position] }).success).toBe(false)
  })

  it('từ chối loại lệnh lạ', () => {
    const position = { ...firstPosition(), type: 'drop table' }
    expect(ingestPayloadSchema.safeParse({ ...valid, positions: [position] }).success).toBe(false)
  })

  it('cho phép margin_level null (không có margin)', () => {
    const ok = { ...valid, account: { ...valid.account, margin_level: null } }
    expect(ingestPayloadSchema.safeParse(ok).success).toBe(true)
  })

  it('cho phép comment tiếng Việt và ký tự đặc biệt', () => {
    const position = { ...firstPosition(), comment: 'Lệnh "thử" \\ nghiệm\n' }
    expect(ingestPayloadSchema.safeParse({ ...valid, positions: [position] }).success).toBe(true)
  })

  describe('trường live (Plan 3B)', () => {
    const sample = { t: 1792500000, eq: 10311.15, bal: 10250.4, fl: 60.75, ml: 2455 }
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ ...sample, t: i }))

    it('chấp nhận reason live/backfill, samples, pos_hash; ml có thể null hoặc vắng', () => {
      const body = {
        ...valid,
        reason: ['live'],
        pos_hash: 'ab12',
        samples: [sample, { ...sample, ml: null }, { t: 1, eq: 1, bal: 1, fl: 0 }],
      }
      expect(ingestPayloadSchema.safeParse(body).success).toBe(true)
      expect(ingestPayloadSchema.safeParse({ ...valid, reason: ['backfill'] }).success).toBe(true)
    })

    it('từ chối quá 20 mẫu và quá 288 nến bù', () => {
      expect(ingestPayloadSchema.safeParse({ ...valid, samples: many(20) }).success).toBe(true)
      expect(ingestPayloadSchema.safeParse({ ...valid, samples: many(21) }).success).toBe(false)
      expect(ingestPayloadSchema.safeParse({ ...valid, bars: many(288) }).success).toBe(true)
      expect(ingestPayloadSchema.safeParse({ ...valid, bars: many(289) }).success).toBe(false)
    })

    it('từ chối mẫu không hữu hạn hoặc thiếu trường bắt buộc', () => {
      const inf = { ...sample, fl: Number.POSITIVE_INFINITY }
      expect(ingestPayloadSchema.safeParse({ ...valid, samples: [inf] }).success).toBe(false)
      const { eq: _eq, ...noEq } = sample
      expect(ingestPayloadSchema.safeParse({ ...valid, samples: [noEq] }).success).toBe(false)
    })

    it('payload kiểu AZ_Spike (không có trường live) vẫn hợp lệ', () => {
      const parsed = ingestPayloadSchema.parse({
        v: 1,
        sid: 'ABCD1234',
        seq: 1,
        reason: ['heartbeat'],
        ts_utc: 1792500000,
        account: valid.account,
        positions: [],
        events: [],
      })
      expect(parsed.samples).toBeUndefined()
      expect(parsed.bars).toBeUndefined()
      expect(parsed.pos_hash).toBeUndefined()
    })
  })
})
