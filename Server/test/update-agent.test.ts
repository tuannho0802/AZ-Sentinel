import { RELEASES_PAGE_URL } from '@az-sentinel/shared'
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
