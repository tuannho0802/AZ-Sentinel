import { describe, expect, it } from 'vitest'
import { editableSchema } from '../src/config'

const base = {
  cloudUrl: 'wss://az.example.workers.dev/api/gw/ws',
  cloudToken: '',
  vps: 'VPS-1',
  idleFlushSec: 60,
}

describe('editableSchema: token cá nhân', () => {
  it('token rỗng được phép (giữ token cũ hoặc chạy cục bộ)', () => {
    expect(editableSchema.safeParse(base).success).toBe(true)
  })

  it('nhận token cá nhân azt_... và cắt khoảng trắng hai đầu', () => {
    const r = editableSchema.safeParse({
      ...base,
      cloudToken: '  azt_dev0123456789abcdef0123456789ab ',
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.cloudToken).toBe('azt_dev0123456789abcdef0123456789ab')
  })

  it('từ chối khóa chung cũ và chuỗi sai hình dạng', () => {
    for (const bad of [
      'old-shared-connect-token-123456',
      'azt_short',
      'azt_has space in it 0123456789',
      'azt_$$$$$$$$$$$$$$$$$$$$',
    ]) {
      expect(editableSchema.safeParse({ ...base, cloudToken: bad }).success, bad).toBe(false)
    }
  })
})
