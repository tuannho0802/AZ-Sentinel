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

  it('áp mặc định positions và events rỗng', () => {
    const { positions: _p, events: _e, ...rest } = valid
    const parsed = ingestPayloadSchema.parse(rest)
    expect(parsed.positions).toEqual([])
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
})
