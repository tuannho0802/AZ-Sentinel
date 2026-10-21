import { describe, expect, it } from 'vitest'
import {
  createLinkRequestSchema,
  normalizeVpsName,
  setVpsNameSchema,
  VPS_NAME_MAX,
} from '../src/vps-name'

describe('normalizeVpsName', () => {
  it('cắt hai đầu, gộp khoảng trắng, giữ chữ hoa/thường và dấu tiếng Việt', () => {
    expect(normalizeVpsName('  VPS   Hà Nội  01 ')).toBe('VPS Hà Nội 01')
  })

  it('bỏ ký tự điều khiển và xuống dòng', () => {
    expect(normalizeVpsName('VPS\n01\t\u0000A')).toBe('VPS 01 A')
  })

  it('rỗng, toàn khoảng trắng hoặc null thì không có tên', () => {
    expect(normalizeVpsName('')).toBeNull()
    expect(normalizeVpsName('   \n ')).toBeNull()
    expect(normalizeVpsName(null)).toBeNull()
    expect(normalizeVpsName(undefined)).toBeNull()
  })

  it(`cắt tối đa ${VPS_NAME_MAX} ký tự (không cắt đôi ký tự nhiều byte)`, () => {
    expect(normalizeVpsName('a'.repeat(100))).toHaveLength(VPS_NAME_MAX)
    const emoji = normalizeVpsName('😀'.repeat(100)) ?? ''
    expect(Array.from(emoji)).toHaveLength(VPS_NAME_MAX)
  })
})

describe('schema yêu cầu', () => {
  it('tạo liên kết: vps_name tùy chọn, chấp nhận null, từ chối sai kiểu', () => {
    expect(createLinkRequestSchema.safeParse({}).success).toBe(true)
    expect(createLinkRequestSchema.safeParse({ vps_name: null }).success).toBe(true)
    expect(createLinkRequestSchema.safeParse({ vps_name: 'VPS-1' }).success).toBe(true)
    expect(createLinkRequestSchema.safeParse({ vps_name: 5 }).success).toBe(false)
  })

  it('đặt tên VPS: bắt buộc có trường, null là xóa, quá dài thô bị từ chối', () => {
    expect(setVpsNameSchema.safeParse({}).success).toBe(false)
    expect(setVpsNameSchema.safeParse({ vps_name: null }).success).toBe(true)
    expect(setVpsNameSchema.safeParse({ vps_name: 'x'.repeat(201) }).success).toBe(false)
  })
})
