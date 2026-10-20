import { describe, expect, it } from 'vitest'
import { normalizeVpsLabel } from '../src/vps-label'

describe('normalizeVpsLabel', () => {
  it('viết hoa và cắt khoảng trắng', () => {
    expect(normalizeVpsLabel('  vps-a12 ')).toBe('VPS-A12')
  })
  it('bỏ ký tự không cho phép', () => {
    expect(normalizeVpsLabel('vps a<12>!')).toBe('VPSA12')
  })
  it('giữ chữ, số, gạch ngang, gạch dưới, dấu chấm', () => {
    expect(normalizeVpsLabel('b51_x.1-2')).toBe('B51_X.1-2')
  })
  it('cắt tối đa 32 ký tự', () => {
    expect(normalizeVpsLabel('a'.repeat(50))).toHaveLength(32)
  })
  it('trả null khi rỗng hoặc chỉ có ký tự không hợp lệ', () => {
    expect(normalizeVpsLabel('')).toBeNull()
    expect(normalizeVpsLabel('   ')).toBeNull()
    expect(normalizeVpsLabel('@@@')).toBeNull()
    expect(normalizeVpsLabel(undefined)).toBeNull()
  })
})
