import { describe, expect, it } from 'vitest'
import {
  CHECK_BAD_INPUT,
  CHECK_INVALID,
  CHECK_OK,
  CHECK_UNREACHABLE,
  checkGatewayToken,
  cloudCheckUrl,
  runCheckToken,
} from '../src/check-token'

const TOKEN = 'azt_dev0123456789abcdef0123456789ab'
const URL_WS = 'wss://az.example.workers.dev/api/gw/ws'

type Seen = { url: string; auth: string | null }
function fakeFetch(status: number, seen: Seen[] = []): typeof fetch {
  return (async (input: unknown, init?: RequestInit) => {
    seen.push({
      url: String(input),
      auth: new Headers(init?.headers).get('authorization'),
    })
    return new Response(status === 200 ? '{"ok":true}' : null, { status })
  }) as unknown as typeof fetch
}
const failingFetch = (async () => {
  throw new TypeError('fetch failed')
}) as unknown as typeof fetch

describe('cloudCheckUrl', () => {
  it('đổi wss/ws thành https/http và trỏ tới /api/gw/check', () => {
    expect(cloudCheckUrl(URL_WS)).toBe('https://az.example.workers.dev/api/gw/check')
    expect(cloudCheckUrl('ws://192.168.1.5:8080/api/gw/ws')).toBe(
      'http://192.168.1.5:8080/api/gw/check',
    )
  })

  it('nhận cả địa chỉ https/http và bỏ phần đường dẫn dư', () => {
    expect(cloudCheckUrl('https://az.example.com/anything?x=1')).toBe(
      'https://az.example.com/api/gw/check',
    )
    expect(cloudCheckUrl(`  ${URL_WS}  `)).toBe('https://az.example.workers.dev/api/gw/check')
  })

  it('từ chối URL sai hoặc giao thức lạ', () => {
    expect(cloudCheckUrl('')).toBeNull()
    expect(cloudCheckUrl('not a url')).toBeNull()
    expect(cloudCheckUrl('ftp://az.example.com')).toBeNull()
  })
})

describe('checkGatewayToken', () => {
  it('200: hợp lệ, gửi token qua Authorization Bearer tới /api/gw/check', async () => {
    const seen: Seen[] = []
    const r = await checkGatewayToken(URL_WS, TOKEN, fakeFetch(200, seen))
    expect(r.code).toBe(CHECK_OK)
    expect(seen).toEqual([
      { url: 'https://az.example.workers.dev/api/gw/check', auth: `Bearer ${TOKEN}` },
    ])
  })

  it('401: bị từ chối (sai/đã thu hồi/đã đặt lại)', async () => {
    const r = await checkGatewayToken(URL_WS, TOKEN, fakeFetch(401))
    expect(r.code).toBe(CHECK_INVALID)
  })

  it('mã khác (5xx) hoặc lỗi mạng: chưa kết luận được về token', async () => {
    expect((await checkGatewayToken(URL_WS, TOKEN, fakeFetch(503))).code).toBe(CHECK_UNREACHABLE)
    expect((await checkGatewayToken(URL_WS, TOKEN, failingFetch)).code).toBe(CHECK_UNREACHABLE)
  })

  it('đầu vào sai: không gọi mạng', async () => {
    const seen: Seen[] = []
    const f = fakeFetch(200, seen)
    expect((await checkGatewayToken('xyz', TOKEN, f)).code).toBe(CHECK_BAD_INPUT)
    expect((await checkGatewayToken(URL_WS, 'old-shared-key', f)).code).toBe(CHECK_BAD_INPUT)
    expect((await checkGatewayToken(URL_WS, '', f)).code).toBe(CHECK_BAD_INPUT)
    expect(seen).toHaveLength(0)
  })

  it('thông báo không chứa token', async () => {
    for (const status of [200, 401, 503]) {
      const r = await checkGatewayToken(URL_WS, TOKEN, fakeFetch(status))
      expect(r.message).not.toContain(TOKEN)
    }
  })
})

describe('runCheckToken (điểm vào dòng lệnh)', () => {
  it('in đúng một dòng và trả mã thoát theo kết quả', async () => {
    const lines: string[] = []
    const code = await runCheckToken([URL_WS, TOKEN], (l) => lines.push(l), fakeFetch(401), {})
    expect(code).toBe(CHECK_INVALID)
    expect(lines).toHaveLength(1)
  })

  it('thiếu tham số thì lấy từ biến môi trường AZ_GW_CLOUD_URL và AZ_GW_TOKEN', async () => {
    const seen: Seen[] = []
    const code = await runCheckToken([], () => {}, fakeFetch(200, seen), {
      AZ_GW_CLOUD_URL: URL_WS,
      AZ_GW_TOKEN: TOKEN,
    } as NodeJS.ProcessEnv)
    expect(code).toBe(CHECK_OK)
    expect(seen[0]?.auth).toBe(`Bearer ${TOKEN}`)
  })

  it('không có gì: mã 3 (đầu vào sai)', async () => {
    expect(await runCheckToken([], () => {}, fakeFetch(200), {})).toBe(CHECK_BAD_INPUT)
  })

  it('mã thoát cố định (bộ cài .iss dựa vào các số này)', () => {
    expect([CHECK_OK, CHECK_INVALID, CHECK_UNREACHABLE, CHECK_BAD_INPUT]).toEqual([0, 1, 2, 3])
  })
})
