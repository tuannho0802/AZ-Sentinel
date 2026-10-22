import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '../../src/lib/password'

describe('băm mật khẩu', () => {
    it('đúng mật khẩu qua, sai thì không; mỗi lần băm có muối khác nhau', async () => {
        const a = await hashPassword('mat-khau-dai-123', 1000)
        const b = await hashPassword('mat-khau-dai-123', 1000)
        expect(a).not.toBe(b)
        expect(a.startsWith('pbkdf2-sha256$1000$')).toBe(true)
        expect(await verifyPassword('mat-khau-dai-123', a)).toBe(true)
        expect(await verifyPassword('mat-khau-dai-124', a)).toBe(false)
    })

    it('chuỗi lưu hỏng hoặc lạ trả false, không ném lỗi', async () => {
        for (const bad of ['', 'abc', 'md5$1$a$b', 'pbkdf2-sha256$x$a$b', 'pbkdf2-sha256$1000$$']) {
            expect(await verifyPassword('x', bad)).toBe(false)
        }
    })
})