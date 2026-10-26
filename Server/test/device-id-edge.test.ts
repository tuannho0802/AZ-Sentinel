import { isRawDeviceId } from '@az-sentinel/shared'
import { describe, expect, it } from 'vitest'
import { hashDeviceId, identifyDevice } from '../src/device-id'

const RAW = 'AbCdEfGhIjKlMnOpQrStUvWx' // 24 ký tự: vừa đủ độ dài tối thiểu
const RAW2 = 'zzzzzzzzzzzzzzzzzzzzzzzz'
const nav = { 'sec-fetch-mode': 'navigate', accept: 'text/html' }

describe('hashDeviceId', () => {
  it('ra 32 ký tự hex, cùng mã thô thì cùng bản băm, khác mã thì khác', () => {
    expect(hashDeviceId(RAW)).toMatch(/^[0-9a-f]{32}$/)
    expect(hashDeviceId(RAW)).toBe(hashDeviceId(RAW))
    expect(hashDeviceId(RAW)).not.toBe(hashDeviceId(RAW2))
  })

  it('bản băm không chứa mã thô', () => {
    expect(hashDeviceId(RAW)).not.toContain(RAW)
  })
})

describe('identifyDevice: thứ tự ưu tiên và dữ liệu xấu', () => {
  it('header Gateway thắng cookie khi có cả hai, và loại là gateway', () => {
    const r = identifyDevice({ 'x-az-device': RAW, cookie: `az_dev=${RAW2}` }, true)
    expect(r.info).toEqual({ id: hashDeviceId(RAW), kind: 'gateway', ua: '' })
    expect(r.setCookie).toBeNull()
  })

  it('header sai định dạng (quá ngắn, ký tự lạ) bị bỏ qua và rơi về cookie', () => {
    for (const bad of ['short', `${RAW}!`, `${RAW} ${RAW}`, 'a'.repeat(65)]) {
      const r = identifyDevice({ 'x-az-device': bad, cookie: `az_dev=${RAW2}` }, false)
      expect(r.info?.id).toBe(hashDeviceId(RAW2))
      expect(r.info?.kind).toBe('web')
    }
  })

  it('đúng ngưỡng độ dài 24 và 64 ký tự thì hợp lệ, 23 và 65 thì không', () => {
    expect(isRawDeviceId('a'.repeat(24))).toBe(true)
    expect(isRawDeviceId('a'.repeat(64))).toBe(true)
    expect(isRawDeviceId('a'.repeat(23))).toBe(false)
    expect(isRawDeviceId('a'.repeat(65))).toBe(false)
  })

  it('cookie hỏng + mở trang thì cấp cookie mới thay thế, không dùng cookie hỏng', () => {
    const r = identifyDevice({ ...nav, cookie: 'az_dev=hong' }, true)
    expect(r.setCookie).toMatch(/^az_dev=[A-Za-z0-9_-]{24,}/)
    expect(r.info?.id).not.toBe(hashDeviceId('hong'))
  })

  it('cookie hỏng + không được phép cấp mới (WebSocket) thì không có thiết bị', () => {
    expect(identifyDevice({ ...nav, cookie: 'az_dev=hong' }, false)).toEqual({
      info: null,
      setCookie: null,
    })
  })

  it('tìm đúng cookie giữa nhiều cookie, có khoảng trắng; tên gần giống không bị nhầm', () => {
    const ok = identifyDevice({ cookie: `a=1;  session=xyz ; az_dev=${RAW}; b=2` }, false)
    expect(ok.info?.id).toBe(hashDeviceId(RAW))
    const lookalike = identifyDevice({ cookie: `xaz_dev=${RAW}; az_dev2=${RAW}` }, false)
    expect(lookalike.info).toBeNull()
  })

  it('header lặp (mảng) thì lấy giá trị đầu tiên', () => {
    const r = identifyDevice({ 'x-az-device': [RAW, RAW2] }, false)
    expect(r.info?.id).toBe(hashDeviceId(RAW))
  })

  it('user-agent được cắt còn 160 ký tự', () => {
    const r = identifyDevice({ 'x-az-device': RAW, 'user-agent': 'u'.repeat(500) }, false)
    expect(r.info?.ua).toHaveLength(160)
  })
})

describe('identifyDevice: khi nào được cấp cookie mới', () => {
  it('chỉ fetch/XHR thật (dest = empty) mới được, ảnh/script/iframe thì không', () => {
    for (const dest of ['image', 'script', 'style', 'iframe', 'document', 'font']) {
      const r = identifyDevice({ 'sec-fetch-mode': 'cors', 'sec-fetch-dest': dest }, true)
      expect(r.info).toBeNull()
    }
    expect(identifyDevice({ 'sec-fetch-mode': 'cors' }, true).info).toBeNull()
    expect(
      identifyDevice({ 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'empty' }, true).info,
    ).toBeNull()
  })

  it('có Sec-Fetch-Mode thì không cho Accept: text/html qua mặt', () => {
    const r = identifyDevice({ 'sec-fetch-mode': 'websocket', accept: 'text/html' }, true)
    expect(r.info).toBeNull()
  })

  it('không có Sec-Fetch-Mode: Accept text/html (trình duyệt cũ) vẫn được cấp, curl thì không', () => {
    expect(identifyDevice({ accept: 'text/html,application/xhtml+xml' }, true).info).not.toBeNull()
    expect(identifyDevice({ accept: '*/*' }, true).info).toBeNull()
    expect(identifyDevice({}, true).info).toBeNull()
  })

  it('mỗi lần cấp là một mã mới hợp lệ, thời hạn 400 ngày, HttpOnly + SameSite=Lax', () => {
    const a = identifyDevice(nav, true)
    const b = identifyDevice(nav, true)
    expect(a.info?.id).not.toBe(b.info?.id)
    const raw = a.setCookie?.match(/^az_dev=([^;]+)/)?.[1]
    expect(isRawDeviceId(raw)).toBe(true)
    expect(hashDeviceId(raw ?? '')).toBe(a.info?.id)
    expect(a.setCookie).toContain(`Max-Age=${400 * 24 * 3600}`)
    expect(a.setCookie).toContain('HttpOnly')
    expect(a.setCookie).toContain('SameSite=Lax')
    expect(a.setCookie).toContain('Path=/')
  })

  it('cờ Secure chỉ có khi đi qua HTTPS (X-Forwarded-Proto hoặc CF-Visitor)', () => {
    expect(identifyDevice(nav, true).setCookie).not.toContain('Secure')
    expect(identifyDevice({ ...nav, 'x-forwarded-proto': 'http' }, true).setCookie).not.toContain(
      'Secure',
    )
    expect(identifyDevice({ ...nav, 'x-forwarded-proto': 'https' }, true).setCookie).toContain(
      'Secure',
    )
    expect(identifyDevice({ ...nav, 'x-forwarded-proto': 'http,https' }, true).setCookie).toContain(
      'Secure',
    )
    expect(
      identifyDevice({ ...nav, 'cf-visitor': '{"scheme":"https"}' }, true).setCookie,
    ).toContain('Secure')
  })
})
