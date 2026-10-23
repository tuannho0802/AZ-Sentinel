import { describe, expect, it } from 'vitest'
import { edgeMessage, normalizeTunnelOrigin } from '../src/edge-auth'

describe('normalizeTunnelOrigin', () => {
  it('nhận https, bỏ đường dẫn và đổi về origin chuẩn', () => {
    expect(normalizeTunnelOrigin('https://abc-def.trycloudflare.com/path?x=1')).toBe(
      'https://abc-def.trycloudflare.com',
    )
    expect(normalizeTunnelOrigin('  https://ABC.example.com  ')).toBe('https://abc.example.com')
  })

  it('từ chối http, IP thô, localhost, cổng lạ, tài khoản, rỗng và quá dài', () => {
    for (const bad of [
      'http://abc.trycloudflare.com',
      'https://1.2.3.4',
      'https://[::1]',
      'https://localhost',
      'https://intranet',
      'https://abc.example.com:8443',
      'https://u:p@abc.example.com',
      '',
      null,
      undefined,
      `https://${'a'.repeat(300)}.com`,
    ]) {
      expect(normalizeTunnelOrigin(bad), String(bad)).toBeNull()
    }
  })
})

describe('edgeMessage', () => {
  it('ghép IP và mốc giờ ổn định', () => {
    expect(edgeMessage('203.0.113.9', 1700000000)).toBe('203.0.113.9|1700000000')
  })
})
