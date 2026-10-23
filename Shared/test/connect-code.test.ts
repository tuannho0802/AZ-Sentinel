import { describe, expect, it } from 'vitest'
import {
  decodeConnectCode,
  encodeConnectCode,
  httpToGatewayWsUrl,
  isLocalOnlyHost,
} from '../src/connect-code'

const TOKEN = 'azt_AbCd1234EfGh5678IjKl9012MnOp3456'
const P = 'wss://vps.example.com/api/gw/ws'
const F = 'wss://az.workers.dev/api/gw/ws'

describe('connect-code', () => {
  it('mã hóa rồi giải mã ra đúng dữ liệu, kể cả khi không có địa chỉ dự phòng', () => {
    const code = encodeConnectCode({ primaryUrl: P, fallbackUrl: F, token: TOKEN })
    expect(code?.startsWith('azc1.')).toBe(true)
    expect(decodeConnectCode(code as string)).toEqual({
      primaryUrl: P,
      fallbackUrl: F,
      token: TOKEN,
    })
    const solo = encodeConnectCode({ primaryUrl: P, fallbackUrl: '', token: TOKEN })
    expect(decodeConnectCode(solo as string)?.fallbackUrl).toBe('')
  })

  it('chịu khoảng trắng và ngoặc kép dán thừa', () => {
    const code = encodeConnectCode({ primaryUrl: P, fallbackUrl: '', token: TOKEN }) as string
    expect(decodeConnectCode(`  "${code}"\n`)?.token).toBe(TOKEN)
  })

  it('từ chối dữ liệu sai', () => {
    expect(encodeConnectCode({ primaryUrl: 'https://x', fallbackUrl: '', token: TOKEN })).toBeNull()
    expect(encodeConnectCode({ primaryUrl: P, fallbackUrl: '', token: 'bad' })).toBeNull()
    expect(decodeConnectCode('azc1.@@@')).toBeNull()
    expect(decodeConnectCode('azt_abc')).toBeNull()
    expect(decodeConnectCode('')).toBeNull()
  })

  it('đổi URL https/http sang ws và nhận biết máy chủ chỉ-cục-bộ', () => {
    expect(httpToGatewayWsUrl('https://vps.example.com')).toBe(
      `${P.replace('/api/gw/ws', '')}/api/gw/ws`,
    )
    expect(httpToGatewayWsUrl('http://10.0.0.5:8080/x')).toBe('ws://10.0.0.5:8080/api/gw/ws')
    expect(httpToGatewayWsUrl('ftp://a')).toBeNull()
    expect(isLocalOnlyHost('localhost:8080')).toBe(true)
    expect(isLocalOnlyHost('127.0.0.1')).toBe(true)
    expect(isLocalOnlyHost('vps.example.com')).toBe(false)
  })
})
