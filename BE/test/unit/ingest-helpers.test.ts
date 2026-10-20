import { describe, expect, it } from 'vitest'
import type { LinkRow } from '../../src/db/sql'
import { isDuplicate, isUniqueViolation, sumMeta } from '../../src/services/ingest-service'
import { makePayload } from '../helpers'

const link = (over: Partial<LinkRow>): LinkRow => ({
  id: 1,
  status: 'active',
  login: 1,
  server: 's',
  last_sid: 'sess01',
  last_seq: 10,
  presence: 0,
  ...over,
})

describe('isDuplicate', () => {
  it('cùng sid và seq <= last_seq là trùng', () => {
    expect(isDuplicate(link({}), makePayload({ sid: 'sess01', seq: 10 }))).toBe(true)
    expect(isDuplicate(link({}), makePayload({ sid: 'sess01', seq: 3 }))).toBe(true)
  })
  it('seq lớn hơn thì không trùng', () => {
    expect(isDuplicate(link({}), makePayload({ sid: 'sess01', seq: 11 }))).toBe(false)
  })
  it('sid khác (EA khởi động lại) không bao giờ trùng dù seq nhỏ', () => {
    expect(isDuplicate(link({}), makePayload({ sid: 'other', seq: 1 }))).toBe(false)
  })
  it('chưa có trạng thái trước đó thì không trùng', () => {
    expect(isDuplicate(link({ last_sid: null, last_seq: null }), makePayload({ seq: 1 }))).toBe(
      false,
    )
  })
})

describe('isUniqueViolation', () => {
  it('nhận ra lỗi ràng buộc duy nhất của SQLite/D1', () => {
    expect(isUniqueViolation(new Error('D1_ERROR: UNIQUE constraint failed: ea_links.login'))).toBe(
      true,
    )
  })
  it('không nhầm với lỗi khác', () => {
    expect(isUniqueViolation(new Error('network down'))).toBe(false)
    expect(isUniqueViolation('UNIQUE constraint failed')).toBe(false)
  })
})

describe('sumMeta', () => {
  it('cộng rows_written và rows_read của các kết quả', () => {
    const r = sumMeta([
      { meta: { rows_written: 1, rows_read: 2 } },
      { meta: { rows_written: 2, rows_read: 0 } },
    ])
    expect(r).toEqual({ rows_written: 3, rows_read: 2 })
  })
  it('mảng rỗng cho 0', () => {
    expect(sumMeta([])).toEqual({ rows_written: 0, rows_read: 0 })
  })
})
