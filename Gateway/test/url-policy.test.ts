import { describe, expect, it } from 'vitest'
import {
  isAllowedCloudUrl,
  isPrivateOrLoopbackHost,
  isTrustedLearnedUrl,
  sanitizeForLog,
} from '../src/url-policy'

describe('isPrivateOrLoopbackHost', () => {
  it.each([
    'localhost',
    'LOCALHOST',
    'app.localhost',
    '127.0.0.1',
    '127.5.5.5',
    '::1',
    '[::1]',
    '10.1.2.3',
    '192.168.1.5',
    '172.16.0.1',
    '172.31.255.255',
    '169.254.1.1',
    'fd12:3456::1',
    'fe80::1',
  ])('nội bộ: %s', (h) => expect(isPrivateOrLoopbackHost(h)).toBe(true))

  it.each([
    'example.com',
    '8.8.8.8',
    '172.15.0.1',
    '172.32.0.1',
    '192.169.1.1',
    '11.0.0.1',
    '1.127.0.1',
    'localhost.evil.com',
    '2001:db8::1',
  ])('không phải nội bộ: %s', (h) => expect(isPrivateOrLoopbackHost(h)).toBe(false))
})

describe('isAllowedCloudUrl (token không được đi qua ws:// ra internet)', () => {
  it.each([
    '',
    '   ',
    'wss://az.workers.dev/api/gw/ws',
    'wss://203.0.113.9/api/gw/ws',
    'ws://127.0.0.1:8080/api/gw/ws',
    'ws://localhost:8787/api/gw/ws',
    'ws://192.168.1.5:8080/api/gw/ws',
    'ws://[::1]:8080/api/gw/ws',
  ])('cho phép: %j', (u) => expect(isAllowedCloudUrl(u)).toBe(true))

  it.each([
    'ws://az.workers.dev/api/gw/ws',
    'ws://203.0.113.9:8080/api/gw/ws',
    'ws://localhost.evil.com/api/gw/ws',
    'http://az.workers.dev',
    'https://az.workers.dev',
    'javascript:1',
    'khong-phai-url',
  ])('từ chối: %j', (u) => expect(isAllowedCloudUrl(u)).toBe(false))
})

describe('isTrustedLearnedUrl (địa chỉ từ danh bạ)', () => {
  const known = ['wss://az.workers.dev/api/gw/ws', 'wss://vps.example.com/api/gw/ws']

  it.each([
    'wss://abc-def-123.trycloudflare.com/api/gw/ws',
    'WSS://ABC.TRYCLOUDFLARE.COM/api/gw/ws',
    'wss://vps.example.com/other/path',
    'wss://az.workers.dev/api/gw/ws',
    'ws://127.0.0.1:9999/api/gw/ws',
    'ws://localhost:9999/api/gw/ws',
  ])('đáng tin: %s', (u) => expect(isTrustedLearnedUrl(u, known)).toBe(true))

  it.each([
    'wss://attacker.example.net/api/gw/ws',
    'wss://trycloudflare.com/api/gw/ws',
    'wss://evil-trycloudflare.com/api/gw/ws',
    'wss://abc.trycloudflare.com.evil.net/api/gw/ws',
    'wss://user:pw@abc.trycloudflare.com/api/gw/ws',
    'ws://abc.trycloudflare.com/api/gw/ws',
    'ws://192.168.1.5/api/gw/ws',
    'ws://attacker.example.net/api/gw/ws',
    'https://abc.trycloudflare.com',
    'javascript:1',
    'khong-phai-url',
  ])('không đáng tin: %s', (u) => expect(isTrustedLearnedUrl(u, known)).toBe(false))

  it('không có cấu hình thì chỉ Quick Tunnel và loopback mới được', () => {
    expect(isTrustedLearnedUrl('wss://az.workers.dev/x', [])).toBe(false)
    expect(isTrustedLearnedUrl('wss://a.trycloudflare.com/x', [])).toBe(true)
  })
})

describe('sanitizeForLog', () => {
  it('bỏ xuống dòng và ký tự điều khiển (chống chèn dòng log giả)', () => {
    const out = sanitizeForLog('lỗi\n2026-01-01T00:00:00Z INFO token ok\r\n\u001b[31mđỏ')
    expect(out).not.toMatch(/[\n\r\u001b]/)
    expect(out).toContain('lỗi')
  })

  it('cắt độ dài', () => {
    expect(sanitizeForLog('a'.repeat(1000), 50)).toHaveLength(50)
  })
})
