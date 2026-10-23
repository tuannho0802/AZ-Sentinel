import { describe, expect, it } from 'vitest'
import { GW_TUNNEL_PATH, tunnelDirectoryUrl, tunnelWsUrl } from '../src/tunnel-directory'

describe('danh bạ tunnel (Plan 3H)', () => {
  it('đổi địa chỉ ws/http của Worker thành địa chỉ danh bạ, bỏ đường dẫn cũ', () => {
    expect(tunnelDirectoryUrl('wss://api.example.workers.dev/api/gw/ws')).toBe(
      `https://api.example.workers.dev${GW_TUNNEL_PATH}`,
    )
    expect(tunnelDirectoryUrl('https://api.example.workers.dev')).toBe(
      'https://api.example.workers.dev/api/gw/tunnel',
    )
    expect(tunnelDirectoryUrl('ws://127.0.0.1:8787/x?y=1')).toBe(
      'http://127.0.0.1:8787/api/gw/tunnel',
    )
  })

  it('địa chỉ sai hoặc giao thức lạ thì null', () => {
    expect(tunnelDirectoryUrl('khong-phai-url')).toBeNull()
    expect(tunnelDirectoryUrl('ftp://host/x')).toBeNull()
  })

  it('tunnelWsUrl: https -> wss kèm đường WebSocket của Gateway', () => {
    expect(tunnelWsUrl('https://abc-def.trycloudflare.com')).toBe(
      'wss://abc-def.trycloudflare.com/api/gw/ws',
    )
  })
})
