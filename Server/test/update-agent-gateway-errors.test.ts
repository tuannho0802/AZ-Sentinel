import {
  type GatewayOffer,
  RELEASES_API_URL,
  RELEASES_PAGE_URL,
  sha256SumsUrl,
} from '@az-sentinel/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UpdateAgent } from '../src/update-agent'

/**
 * Ca LỖI và ca thay đổi phát hành của việc Server ép Gateway cập nhật: GitHub chập chờn, file băm hỏng,
 * hub lỗi khi được báo, release bị xóa hoặc thay bản. Server không được sập và không được giữ địa chỉ tải đã chết.
 */

const H1 = 'a'.repeat(64)
const H2 = 'b'.repeat(64)
const rel = (tag: string, assets = true) => ({
  tag_name: tag,
  html_url: `${RELEASES_PAGE_URL}/tag/${tag}`,
  draft: false,
  prerelease: false,
  ...(assets ? { assets: [{ name: 'az-gateway.exe' }, { name: 'SHA256SUMS.txt' }] } : {}),
})
const line = (h: string) => `${h}  az-gateway.exe\n`

/** GitHub giả có thể đổi giữa các lần tick: danh sách release và nội dung file băm theo phiên bản. */
function world() {
  const st = {
    list: [rel('gateway-v0.4.0')] as unknown[],
    listStatus: 200,
    listThrows: false,
    sums: { '0.4.0': () => new Response(line(H1)) } as Record<string, () => Response>,
  }
  const calls: string[] = []
  const fetchFn = (async (input: string | URL | Request) => {
    const url = String(input)
    calls.push(url)
    if (url === RELEASES_API_URL) {
      if (st.listThrows) throw new TypeError('fetch failed')
      if (st.listStatus !== 200) return new Response('{}', { status: st.listStatus })
      return Response.json(st.list)
    }
    for (const [v, f] of Object.entries(st.sums)) if (url === sha256SumsUrl(v)) return f()
    throw new Error(`địa chỉ ngoài kịch bản: ${url}`)
  }) as typeof fetch
  const sumsCalls = (v: string) => calls.filter((u) => u === sha256SumsUrl(v)).length
  return { st, calls, fetchFn, sumsCalls }
}

function make(w: ReturnType<typeof world>, onGatewayOffer?: (o: GatewayOffer) => void) {
  const lines: string[] = []
  const add = (lvl: string) => (m: string) => lines.push(`${lvl}: ${m}`)
  const offers: GatewayOffer[] = []
  const agent = new UpdateAgent({
    current: '0.2.3',
    log: { debug: add('debug'), info: add('info'), warn: add('warn'), error: add('error') },
    fetchFn: w.fetchFn,
    nowMs: () => 1_700_000_000_000,
    gatewayPush: true,
    onGatewayOffer:
      onGatewayOffer ??
      ((o) => {
        offers.push(o)
      }),
  })
  return { agent, lines, offers }
}

afterEach(() => vi.useRealTimers())

describe('ép Gateway: lỗi khi lấy file băm', () => {
  it('mất mạng đúng lúc tải SHA256SUMS.txt: chưa có offer, lần sau tự phục hồi và báo hub một lần', async () => {
    const w = world()
    let down = true
    w.st.sums['0.4.0'] = () => {
      if (down) throw new TypeError('fetch failed')
      return new Response(line(H1))
    }
    const { agent, offers, lines } = make(w)
    await agent.tick()
    expect(agent.gatewayOffer()).toBeNull()
    expect(offers).toHaveLength(0)
    expect(lines.some((l) => l.startsWith('warn:') && l.includes('băm'))).toBe(true)
    down = false
    await agent.tick()
    expect(agent.gatewayOffer()?.sha256).toBe(H1)
    expect(offers).toHaveLength(1)
    agent.stop()
  })

  it('SHA256SUMS.txt quá lớn: chỉ đọc 8 KB đầu, dòng nằm sau đó bị bỏ', async () => {
    const w = world()
    w.st.sums['0.4.0'] = () => new Response(`${'x'.repeat(9000)}\n${line(H1)}`)
    const { agent } = make(w)
    await agent.tick()
    expect(agent.gatewayOffer()).toBeNull()
    agent.stop()
  })

  it('dòng băm nằm trong 8 KB đầu thì vẫn nhận dù phía sau là rác', async () => {
    const w = world()
    w.st.sums['0.4.0'] = () => new Response(`${line(H1)}${'x'.repeat(9000)}`)
    const { agent } = make(w)
    await agent.tick()
    expect(agent.gatewayOffer()?.sha256).toBe(H1)
    agent.stop()
  })

  it.each([
    ['rỗng', ''],
    ['chỉ có băm của file khác', `${'e'.repeat(64)}  AZSentinel-Gateway-Setup.exe\n`],
    ['băm ngắn', 'abc123  az-gateway.exe\n'],
    ['băm không phải hex', `${'z'.repeat(64)}  az-gateway.exe\n`],
    ['tên file kèm đường dẫn', `${H1}  dist/az-gateway.exe\n`],
  ])('SHA256SUMS.txt %s: không có offer', async (_n, body) => {
    const w = world()
    w.st.sums['0.4.0'] = () => new Response(body)
    const { agent } = make(w)
    await agent.tick()
    expect(agent.gatewayOffer()).toBeNull()
    agent.stop()
  })

  it('lỗi 5xx liên tục: chỉ cảnh báo một lần, không ngập log', async () => {
    const w = world()
    w.st.sums['0.4.0'] = () => new Response('x', { status: 502 })
    const { agent, lines } = make(w)
    for (let i = 0; i < 4; i++) await agent.tick()
    expect(lines.filter((l) => l.startsWith('warn:') && l.includes('băm'))).toHaveLength(1)
    agent.stop()
  })
})

describe('ép Gateway: hub lỗi khi được báo', () => {
  it('onGatewayOffer ném lỗi: offer vẫn giữ, ghi cảnh báo đúng nguyên nhân, không tải băm lại', async () => {
    const w = world()
    const { agent, lines } = make(w, () => {
      throw new Error('hub chết')
    })
    await expect(agent.tick()).resolves.toBeUndefined()
    expect(agent.gatewayOffer()?.version).toBe('0.4.0')
    expect(lines.some((l) => l.includes('báo hub') && l.includes('hub chết'))).toBe(true)
    expect(lines.some((l) => l.includes('không lấy được băm'))).toBe(false)
    await agent.tick()
    expect(w.sumsCalls('0.4.0')).toBe(1)
    agent.stop()
  })
})

describe('ép Gateway: phát hành thay đổi', () => {
  it('có bản Gateway mới hơn: offer đổi sang bản đó (băm mới) và báo hub lại', async () => {
    const w = world()
    const { agent, offers } = make(w)
    await agent.tick()
    w.st.list = [rel('gateway-v0.4.1'), rel('gateway-v0.4.0')]
    w.st.sums['0.4.1'] = () => new Response(line(H2))
    await agent.tick()
    expect(agent.gatewayOffer()?.version).toBe('0.4.1')
    expect(agent.gatewayOffer()?.sha256).toBe(H2)
    expect(offers.map((o) => o.version)).toEqual(['0.4.0', '0.4.1'])
    agent.stop()
  })

  it('release bị xóa hết (không còn bản đủ file): thôi ép, không giữ địa chỉ tải đã chết', async () => {
    const w = world()
    const { agent } = make(w)
    await agent.tick()
    expect(agent.gatewayOffer()).not.toBeNull()
    w.st.list = [rel('server-v0.3.0', false)]
    await agent.tick()
    expect(agent.gatewayOffer()).toBeNull()
    agent.stop()
  })

  it('release mới nhất bị xóa: offer lùi về bản còn lại (Gateway vẫn không bao giờ hạ cấp)', async () => {
    const w = world()
    w.st.list = [rel('gateway-v0.4.0'), rel('gateway-v0.3.9')]
    w.st.sums['0.3.9'] = () => new Response(line(H2))
    const { agent } = make(w)
    await agent.tick()
    expect(agent.gatewayOffer()?.version).toBe('0.4.0')
    w.st.list = [rel('gateway-v0.3.9')]
    await agent.tick()
    expect(agent.gatewayOffer()?.version).toBe('0.3.9')
    agent.stop()
  })

  it('xóa rồi phát hành lại cùng số phiên bản: lấy lại băm mới', async () => {
    const w = world()
    const { agent, offers } = make(w)
    await agent.tick()
    w.st.list = [rel('server-v0.3.0', false)] // đã xóa
    await agent.tick()
    w.st.list = [rel('gateway-v0.4.0')] // phát hành lại, file khác
    w.st.sums['0.4.0'] = () => new Response(line(H2))
    await agent.tick()
    expect(agent.gatewayOffer()?.sha256).toBe(H2)
    expect(offers.map((o) => o.sha256)).toEqual([H1, H2])
    agent.stop()
  })
})

describe('ép Gateway: GitHub chập chờn không làm mất offer đang có', () => {
  it.each([
    [
      'HTTP 500',
      (w: ReturnType<typeof world>) => {
        w.st.listStatus = 500
      },
    ],
    [
      'HTTP 403 (hết hạn mức)',
      (w: ReturnType<typeof world>) => {
        w.st.listStatus = 403
      },
    ],
    [
      'mất mạng',
      (w: ReturnType<typeof world>) => {
        w.st.listThrows = true
      },
    ],
  ])('danh sách release lỗi (%s): giữ offer cũ', async (_n, breakIt) => {
    const w = world()
    const { agent } = make(w)
    await agent.tick()
    breakIt(w)
    await expect(agent.tick()).resolves.toBeUndefined()
    expect(agent.gatewayOffer()?.version).toBe('0.4.0')
    agent.stop()
  })

  it('danh sách release là dữ liệu lạ (không phải mảng): không sập, không đổi offer', async () => {
    const w = world()
    const { agent } = make(w)
    await agent.tick()
    w.st.list = { message: 'rate limited' } as unknown as unknown[]
    await expect(agent.tick()).resolves.toBeUndefined()
    agent.stop()
  })
})
