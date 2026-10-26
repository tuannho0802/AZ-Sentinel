import { describe, expect, it } from 'vitest'
import { identifyDevice } from '../src/device-id'

const nav = { 'sec-fetch-mode': 'navigate', accept: 'text/html' }
const xhr = { 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty', accept: 'application/json' }

describe('identifyDevice: cấp cookie thiết bị cho trình duyệt', () => {
  it('mở trang thì cấp cookie mới', () => {
    const r = identifyDevice(nav, true)
    expect(r.info?.kind).toBe('web')
    expect(r.setCookie).toContain('az_dev=')
  })

  it('đi qua Worker: lời gọi fetch /api/* của trình duyệt cũng được cấp cookie', () => {
    for (const mode of ['cors', 'same-origin']) {
      const r = identifyDevice({ ...xhr, 'sec-fetch-mode': mode }, true)
      expect(r.info).not.toBeNull()
      expect(r.setCookie).toContain('HttpOnly')
    }
  })

  it('có cookie thì dùng lại, không cấp mới', () => {
    const first = identifyDevice(nav, true)
    const raw = first.setCookie?.split(';')[0] ?? ''
    const again = identifyDevice({ ...xhr, cookie: raw }, true)
    expect(again.setCookie).toBeNull()
    expect(again.info?.id).toBe(first.info?.id)
  })

  it('script/curl (không có Sec-Fetch, không xin HTML) và WebSocket thì không được cấp', () => {
    expect(identifyDevice({ accept: 'application/json' }, true).info).toBeNull()
    expect(
      identifyDevice({ 'sec-fetch-mode': 'websocket', 'sec-fetch-dest': 'websocket' }, true).info,
    ).toBeNull()
    expect(identifyDevice(xhr, false).info).toBeNull()
  })
})
