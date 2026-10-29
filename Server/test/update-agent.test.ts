import {
  type GatewayOffer,
  gatewayAssetUrl,
  RELEASES_API_URL,
  RELEASES_PAGE_URL,
  sha256SumsUrl,
} from '@az-sentinel/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UpdateAgent } from '../src/update-agent'

const rel = (tag: string) => ({
  tag_name: tag,
  html_url: `${RELEASES_PAGE_URL}/tag/${tag}`,
  draft: false,
  prerelease: false,
})
const RELEASES = [rel('gateway-v0.3.2'), rel('server-v0.3.0'), rel('server-v0.2.3')]

type Step = () => Response | Promise<Response>
const ok = (list: unknown = RELEASES, etag = '"v1"') =>
  (() => Response.json(list, { headers: { etag } })) as Step
const notModified = (() => new Response(null, { status: 304 })) as Step
const status = (code: number) => (() => new Response('{}', { status: code })) as Step
const netError = (() => {
  throw new TypeError('fetch failed')
}) as Step

/** GitHub giả: mỗi lần gọi chạy bước kế tiếp trong kịch bản và ghi lại header gửi lên. */
function fakeGithub(steps: Step[]) {
  const calls: Array<{ url: string; ifNoneMatch: string | null }> = []
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    calls.push({ url: String(input), ifNoneMatch: headers.get('if-none-match') })
    const step = steps[Math.min(calls.length - 1, steps.length - 1)]
    if (!step) throw new Error('kịch bản trống')
    return step()
  }) as typeof fetch
  return { fetchFn, calls }
}

function makeLog() {
  const lines: string[] = []
  const add = (lvl: string) => (m: string) => lines.push(`${lvl}: ${m}`)
  return {
    lines,
    log: { debug: add('debug'), info: add('info'), warn: add('warn'), error: add('error') },
  }
}

function setup(
  steps: Step[],
  current = '0.2.3',
  extra: { checkSec?: number; retrySec?: number } = {},
) {
  const gh = fakeGithub(steps)
  const l = makeLog()
  const agent = new UpdateAgent({
    current,
    log: l.log,
    fetchFn: gh.fetchFn,
    nowMs: () => 1_700_000_000_000,
    ...extra,
  })
  return { agent, ...gh, ...l }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('UpdateAgent', () => {
  it('chưa kiểm tra lần nào thì chưa có kết quả', () => {
    const { agent } = setup([ok()])
    expect(agent.status()).toEqual({ server: null, checkedAt: null })
  })

  it('có bản server-v mới hơn: báo available, bỏ qua tag gateway, ghi log một lần', async () => {
    const { agent, lines, calls } = setup([ok()])
    await agent.tick()
    agent.stop()
    expect(agent.status()).toEqual({
      server: { latest: '0.3.0', url: `${RELEASES_PAGE_URL}/tag/server-v0.3.0`, available: true },
      checkedAt: 1_700_000_000,
    })
    expect(calls[0]?.url).toContain('api.github.com/repos/tuannho0802/AZ-Sentinel/releases')
    expect(lines.filter((l) => l.startsWith('info:') && l.includes('0.3.0'))).toHaveLength(1)
  })

  it('đang chạy bản mới nhất: available false, không log', async () => {
    const { agent, lines } = setup([ok()], '0.3.0')
    await agent.tick()
    agent.stop()
    expect(agent.status().server?.available).toBe(false)
    expect(lines).toEqual([])
  })

  it('lần sau gửi ETag; 304 giữ kết quả cũ và làm mới thời điểm kiểm tra', async () => {
    let now = 1_700_000_000_000
    const gh = fakeGithub([ok(), notModified])
    const l = makeLog()
    const agent = new UpdateAgent({
      current: '0.2.3',
      log: l.log,
      fetchFn: gh.fetchFn,
      nowMs: () => now,
    })
    await agent.tick()
    now += 300_000
    await agent.tick()
    agent.stop()
    expect(gh.calls[0]?.ifNoneMatch).toBeNull()
    expect(gh.calls[1]?.ifNoneMatch).toBe('"v1"')
    expect(agent.status().server?.latest).toBe('0.3.0')
    expect(agent.status().checkedAt).toBe(1_700_000_300)
    expect(l.lines.filter((x) => x.includes('0.3.0'))).toHaveLength(1)
  })

  it('có bản mới hơn nữa thì báo lại', async () => {
    const { agent, lines } = setup([
      ok(RELEASES, '"v1"'),
      ok([rel('server-v0.4.0'), ...RELEASES], '"v2"'),
    ])
    await agent.tick()
    await agent.tick()
    agent.stop()
    expect(agent.status().server?.latest).toBe('0.4.0')
    expect(lines.filter((l) => l.includes('có bản Server mới'))).toHaveLength(2)
  })

  it('lỗi mạng: không có kết quả, cảnh báo một lần (lặp lại chỉ ghi debug), phục hồi thì báo', async () => {
    const { agent, lines } = setup([netError, netError, ok()])
    await agent.tick()
    await agent.tick()
    expect(agent.status()).toEqual({ server: null, checkedAt: null })
    expect(lines.filter((l) => l.startsWith('warn:'))).toHaveLength(1)
    expect(lines.some((l) => l.startsWith('debug:'))).toBe(true)
    await agent.tick()
    agent.stop()
    expect(agent.status().server?.available).toBe(true)
    expect(lines.some((l) => l.includes('đã kiểm tra lại được'))).toBe(true)
  })

  it('GitHub trả lỗi HTTP hoặc dữ liệu lạ: không làm hỏng, không báo có bản mới', async () => {
    const { agent } = setup([status(500), ok({ message: 'oops' })])
    await agent.tick()
    expect(agent.status().server).toBeNull()
    await agent.tick()
    agent.stop()
    expect(agent.status().server).toBeNull()
  })

  it('lỗi 5xx thử lại sớm (retrySec), hết hạn mức 403 chờ đủ một chu kỳ (checkSec)', async () => {
    vi.useFakeTimers()
    const a = setup([status(500), ok()], '0.2.3', { checkSec: 300, retrySec: 120 })
    a.agent.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(a.calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(119_000)
    expect(a.calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(a.calls).toHaveLength(2)
    a.agent.stop()

    const b = setup([status(403), ok()], '0.2.3', { checkSec: 300, retrySec: 120 })
    b.agent.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(200_000)
    expect(b.calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(100_000)
    expect(b.calls).toHaveLength(2)
    b.agent.stop()
  })

  it('stop() dừng hẹn lịch', async () => {
    vi.useFakeTimers()
    const { agent, calls } = setup([ok()], '0.2.3', { checkSec: 300 })
    agent.start()
    await vi.advanceTimersByTimeAsync(0)
    agent.stop()
    await vi.advanceTimersByTimeAsync(3_600_000)
    expect(calls).toHaveLength(1)
  })
})

describe('ép Gateway đồng bộ bản mới (gatewayPush)', () => {
  const H = 'd'.repeat(64)
  const withAssets = (tag: string) => ({
    ...rel(tag),
    assets: [
      { name: 'AZSentinel-Gateway-Setup.exe' },
      { name: 'az-gateway.exe' },
      { name: 'SHA256SUMS.txt' },
    ],
  })
  const sums = (h = H) =>
    `${'e'.repeat(64)}  AZSentinel-Gateway-Setup.exe\r\n${h}  az-gateway.exe\r\n`

  /** GitHub giả định tuyến theo địa chỉ: danh sách release và file băm. */
  function github(opts: { list?: unknown; sums?: () => Response; etagOnly?: boolean } = {}) {
    const calls: string[] = []
    let listCalls = 0
    const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      calls.push(url)
      if (url === RELEASES_API_URL) {
        listCalls++
        const inm = new Headers(init?.headers).get('if-none-match')
        if (inm && opts.etagOnly) return new Response(null, { status: 304 })
        return Response.json(opts.list ?? [withAssets('gateway-v0.4.0'), rel('server-v0.3.0')], {
          headers: { etag: '"v1"' },
        })
      }
      if (url === sha256SumsUrl('0.4.0')) return (opts.sums ?? (() => new Response(sums())))()
      throw new Error(`địa chỉ ngoài kịch bản: ${url}`)
    }) as typeof fetch
    return { fetchFn, calls, listCalls: () => listCalls }
  }

  function make(gh: ReturnType<typeof github>, over: { gatewayPush?: boolean } = {}) {
    const l = makeLog()
    const offers: GatewayOffer[] = []
    const agent = new UpdateAgent({
      current: '0.2.3',
      log: l.log,
      fetchFn: gh.fetchFn,
      nowMs: () => 1_700_000_000_000,
      gatewayPush: over.gatewayPush ?? true,
      onGatewayOffer: (o) => offers.push(o),
    })
    return { agent, offers, ...l }
  }

  afterEach(() => vi.useRealTimers())

  it('lấy băm từ SHA256SUMS.txt, dựng địa chỉ từ repo+tag và báo hub đúng một lần', async () => {
    const gh = github()
    const { agent, offers } = make(gh)
    await agent.tick()
    expect(agent.gatewayOffer()).toEqual({
      version: '0.4.0',
      url: gatewayAssetUrl('0.4.0'),
      sha256: H,
    })
    expect(offers).toHaveLength(1)
    await agent.tick() // lần sau: cùng phiên bản thì không tải băm lại, không báo lại
    expect(gh.calls.filter((u) => u === sha256SumsUrl('0.4.0'))).toHaveLength(1)
    expect(offers).toHaveLength(1)
    agent.stop()
  })

  it('tắt gatewayPush: không hỏi file băm, không có offer (chỉ banner như cũ)', async () => {
    const gh = github()
    const { agent, offers } = make(gh, { gatewayPush: false })
    await agent.tick()
    expect(agent.gatewayOffer()).toBeNull()
    expect(offers).toHaveLength(0)
    expect(gh.calls).toEqual([RELEASES_API_URL])
    expect(agent.status().server?.latest).toBe('0.3.0')
    agent.stop()
  })

  it('release Gateway chưa kèm az-gateway.exe và file băm (bản cũ): không có offer', async () => {
    const gh = github({ list: [rel('gateway-v0.4.0'), rel('server-v0.3.0')] })
    const { agent, offers } = make(gh)
    await agent.tick()
    expect(agent.gatewayOffer()).toBeNull()
    expect(offers).toHaveLength(0)
    expect(gh.calls).toEqual([RELEASES_API_URL])
    agent.stop()
  })

  it('SHA256SUMS.txt lỗi hoặc thiếu dòng exe: không có offer, ghi cảnh báo một lần, thử lại sớm', async () => {
    let fail = true
    const gh = github({
      sums: () => (fail ? new Response('x', { status: 404 }) : new Response(sums())),
    })
    const { agent, offers, lines } = make(gh)
    await agent.tick()
    await agent.tick()
    expect(agent.gatewayOffer()).toBeNull()
    expect(lines.filter((l) => l.startsWith('warn:') && l.includes('băm'))).toHaveLength(1)
    fail = false
    await agent.tick()
    expect(agent.gatewayOffer()?.sha256).toBe(H)
    expect(offers).toHaveLength(1)
    agent.stop()
  })

  it('danh sách 304 (không đổi) nhưng lần lấy băm trước lỗi: vẫn thử lại băm', async () => {
    let fail = true
    const gh = github({
      etagOnly: true,
      sums: () => (fail ? new Response('x', { status: 500 }) : new Response(sums())),
    })
    const { agent } = make(gh)
    await agent.tick() // 200 + băm lỗi
    fail = false
    await agent.tick() // 304 nhưng băm được thử lại
    expect(gh.listCalls()).toBe(2)
    expect(agent.gatewayOffer()?.version).toBe('0.4.0')
    agent.stop()
  })

  it('dòng băm của exe sai dạng thì bị bỏ (không đưa băm rác cho Gateway)', async () => {
    const gh = github({ sums: () => new Response('abc123  az-gateway.exe\n') })
    const { agent } = make(gh)
    await agent.tick()
    expect(agent.gatewayOffer()).toBeNull()
    agent.stop()
  })
})
