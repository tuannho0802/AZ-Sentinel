import { describe, expect, it } from 'vitest'
import {
  createDeviceRuleRequestSchema,
  deviceHashInput,
  isHashedDeviceId,
  isRawDeviceId,
  setDeviceGuardRequestSchema,
  shortDeviceId,
  updateDeviceRuleRequestSchema,
} from '../src/device-rules'

const HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'

describe('isRawDeviceId', () => {
  it('chỉ nhận chuỗi 24-64 ký tự chữ, số, gạch dưới, gạch ngang', () => {
    expect(isRawDeviceId('a'.repeat(24))).toBe(true)
    expect(isRawDeviceId('A_b-9'.repeat(8))).toBe(true)
    expect(isRawDeviceId('a'.repeat(23))).toBe(false)
    expect(isRawDeviceId('a'.repeat(65))).toBe(false)
    expect(isRawDeviceId(`${'a'.repeat(24)}=`)).toBe(false)
    expect(isRawDeviceId(`${'a'.repeat(23)}\n`)).toBe(false)
  })

  it('không phải chuỗi thì false (undefined, số, null, mảng)', () => {
    for (const v of [undefined, null, 123, ['a'.repeat(24)], {}])
      expect(isRawDeviceId(v)).toBe(false)
  })
})

describe('isHashedDeviceId / shortDeviceId / deviceHashInput', () => {
  it('bản băm phải đúng 32 ký tự hex thường', () => {
    expect(isHashedDeviceId(HASH)).toBe(true)
    expect(isHashedDeviceId(HASH.toUpperCase())).toBe(false)
    expect(isHashedDeviceId(HASH.slice(1))).toBe(false)
    expect(isHashedDeviceId(`${HASH}0`)).toBe(false)
    expect(isHashedDeviceId(`${HASH.slice(0, 31)}g`)).toBe(false)
    expect(isHashedDeviceId(null)).toBe(false)
  })

  it('mã ngắn là 8 ký tự đầu; chuỗi băm có tiền tố riêng để không đụng chạm hệ khác', () => {
    expect(shortDeviceId(HASH)).toBe('a1b2c3d4')
    expect(deviceHashInput('abc')).toBe('az-device:abc')
  })
})

describe('createDeviceRuleRequestSchema', () => {
  it('mặc định nhãn rỗng và chế độ device_only', () => {
    expect(createDeviceRuleRequestSchema.parse({ device_id: HASH })).toEqual({
      device_id: HASH,
      label: '',
      mode: 'device_only',
    })
  })

  it('tự cắt khoảng trắng và hạ chữ thường mã thiết bị (admin dán từ nơi khác)', () => {
    const r = createDeviceRuleRequestSchema.parse({
      device_id: `  ${HASH.toUpperCase()}\n`,
      label: '  Laptop  ',
    })
    expect(r.device_id).toBe(HASH)
    expect(r.label).toBe('Laptop')
  })

  it('từ chối mã sai (8 ký tự ngắn, không phải hex, thiếu), nhãn quá 64 ký tự, chế độ lạ', () => {
    expect(createDeviceRuleRequestSchema.safeParse({ device_id: 'a1b2c3d4' }).success).toBe(false)
    expect(createDeviceRuleRequestSchema.safeParse({ device_id: 'z'.repeat(32) }).success).toBe(
      false,
    )
    expect(createDeviceRuleRequestSchema.safeParse({}).success).toBe(false)
    expect(
      createDeviceRuleRequestSchema.safeParse({ device_id: HASH, label: 'x'.repeat(65) }).success,
    ).toBe(false)
    expect(
      createDeviceRuleRequestSchema.safeParse({ device_id: HASH, label: 'x'.repeat(64) }).success,
    ).toBe(true)
    expect(createDeviceRuleRequestSchema.safeParse({ device_id: HASH, mode: 'all' }).success).toBe(
      false,
    )
  })

  it('nhận cả hai chế độ hợp lệ', () => {
    for (const mode of ['any_ip', 'device_only']) {
      expect(createDeviceRuleRequestSchema.parse({ device_id: HASH, mode }).mode).toBe(mode)
    }
  })
})

describe('updateDeviceRuleRequestSchema', () => {
  it('phải sửa ít nhất một thứ: object rỗng bị từ chối', () => {
    expect(updateDeviceRuleRequestSchema.safeParse({}).success).toBe(false)
    expect(updateDeviceRuleRequestSchema.safeParse({ label: undefined }).success).toBe(false)
  })

  it('nhãn rỗng là hợp lệ (xóa nhãn), chỉ đổi chế độ cũng được', () => {
    expect(updateDeviceRuleRequestSchema.safeParse({ label: '' }).success).toBe(true)
    expect(updateDeviceRuleRequestSchema.safeParse({ mode: 'any_ip' }).success).toBe(true)
    expect(updateDeviceRuleRequestSchema.safeParse({ mode: 'nope' }).success).toBe(false)
  })
})

describe('setDeviceGuardRequestSchema', () => {
  it('chỉ nhận boolean thật, chuỗi "true" hay số 1 bị từ chối', () => {
    expect(setDeviceGuardRequestSchema.safeParse({ enforce: true }).success).toBe(true)
    expect(setDeviceGuardRequestSchema.safeParse({ enforce: false }).success).toBe(true)
    expect(setDeviceGuardRequestSchema.safeParse({ enforce: 'true' }).success).toBe(false)
    expect(setDeviceGuardRequestSchema.safeParse({ enforce: 1 }).success).toBe(false)
    expect(setDeviceGuardRequestSchema.safeParse({}).success).toBe(false)
  })
})
