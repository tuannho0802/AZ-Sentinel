import { env } from 'cloudflare:workers'
import type { GateResponse, IngestResponse } from '@az-sentinel/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../../src/app'
import type { HubClient, PublishResult } from '../../src/live/hub-types'
import { liveConfig, normalizeSamples } from '../../src/services/live-service'
import type { Bindings } from '../../src/types'
import { count, makePayload, resetDb, seedLink, tradeEvent } from '../helpers'

const ok: PublishResult = {
  wanted: true,
  duplicate: false,
  rateLimited: false,
  retryAfterSec: 0,
  barDue: false,
  posChanged: false,
}
const fakeHub = (publish: Partial<PublishResult> | Error = {}, wanted = true) => {
  const calls = { publish: 0, gate: 0 }
  const hub: HubClient = {
    shouldBeLive: async () => {
      calls.gate += 1
      return { wanted }
    },
    publish: async () => {
      calls.publish += 1
      if (publish instanceof Error) throw publish
      return { ...ok, wanted, ...publish }
    },
  }
  return { hub, calls }
}
const bindings = env as unknown as Bindings
const appWith = (hub: HubClient) => createApp({ getHub: () => hub })
const now = () => Math.floor(Date.now() / 1000)
const sample = (over: Record<string, unknown> = {}) => ({
  t: now(),
  eq: 10100,
  bal: 10000,
  fl: 100,
  ...over,
})
let n = 0
const live = (over: Record<string, unknown> = {}) =>
  makePayload({ reason: ['live'], sid: 'live01', seq: ++n, samples: [sample()], ...over })

function gate(app: ReturnType<typeof createApp>, key: string | null) {
  const headers: Record<string, string> = key === null ? {} : { 'X-API-Key': key }
  return app.fetch(new Request('http://az.test/api/ea/v1/gate', { headers }), bindings)
}
function ingest(app: ReturnType<typeof createApp>, key: string, body: unknown) {
  return app.fetch(
    new Request('http://az.test/api/ea/v1/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    bindings,
  )
}
type Meta = { rows_written: number }
const rows = (j: { meta?: unknown }) => (j.meta as Meta | undefined)?.rows_written

beforeEach(resetDb)

describe('gate (B-01..B-06)', () => {
  it('B-01: thiếu khóa, khóa sai, liên kết khóa => 401, 401, 403; không ghi D1', async () => {
    const { hub } = fakeHub()
    const app = appWith(hub)
    const { key: disabledKey } = await seedLink({ status: 'disabled' })
    expect((await gate(app, null)).status).toBe(401)
    expect((await gate(app, 'khoa-sai')).status).toBe(401)
    expect((await gate(app, disabledKey)).status).toBe(403)
    expect(await count('link_state')).toBe(0)
    expect(await count('events')).toBe(0)
  })

  it('B-02: không có viewer => idle, next_poll_sec 120', async () => {
    const { key } = await seedLink()
    const res = await gate(appWith(fakeHub({}, false).hub), key)
    const j = (await res.json()) as GateResponse
    expect(res.status).toBe(200)
    expect(j).toMatchObject({ mode: 'idle', next_poll_sec: 120, interval_sec: 10, lease_sec: 45 })
  })

  it('B-03: có viewer => live, interval 10, lease 45', async () => {
    const { key } = await seedLink()
    const j = (await (await gate(appWith(fakeHub().hub), key)).json()) as GateResponse
    expect(j).toMatchObject({ mode: 'live', interval_sec: 10, lease_sec: 45 })
    expect(Math.abs(j.server_time - now())).toBeLessThan(5)
  })

  it('B-04: hai gate liên tiếp chỉ ghi tối đa 1 dòng (last_seen_at điều tiết)', async () => {
    const { key, id } = await seedLink()
    const app = appWith(fakeHub().hub)
    await ingest(app, key, makePayload({ reason: ['heartbeat'] }))
    await env.DB.prepare('UPDATE link_state SET last_seen_at = ? WHERE link_id = ?')
      .bind(now() - 300, id)
      .run()
    const first = (await (await gate(app, key)).json()) as { meta?: Meta }
    const second = (await (await gate(app, key)).json()) as { meta?: Meta }
    expect(rows(first)).toBe(1)
    expect(rows(second)).toBeUndefined() // không ghi nên không có meta
  })

  it('B-05: hub lỗi hoặc treo => 200 idle (fail-closed), không 5xx', async () => {
    const { key } = await seedLink()
    const boom: HubClient = { ...fakeHub().hub, shouldBeLive: () => Promise.reject(new Error('x')) }
    const j1 = (await (await gate(appWith(boom), key)).json()) as GateResponse
    expect(j1.mode).toBe('idle')
    const hang: HubClient = { ...fakeHub().hub, shouldBeLive: () => new Promise(() => {}) }
    const res = await gate(appWith(hang), key)
    expect(res.status).toBe(200)
    expect(((await res.json()) as GateResponse).mode).toBe('idle')
  })

  it('B-06: presence=1 => đặt 0 và chèn đúng 1 sự kiện online', async () => {
    const { key, id } = await seedLink()
    const app = appWith(fakeHub().hub)
    await ingest(app, key, makePayload({ reason: ['heartbeat'] }))
    await env.DB.prepare('UPDATE link_state SET presence = 1 WHERE link_id = ?').bind(id).run()
    await gate(app, key)
    await gate(app, key)
    expect(await count('events', "type = 'online'")).toBe(1)
    expect(await count('link_state', 'presence = 0')).toBe(1)
  })
})

describe('ingest live (B-07..B-18, B-29)', () => {
  it('B-07: không còn viewer => idle, có ack_seq', async () => {
    const { key } = await seedLink()
    const p = live()
    const res = await ingest(appWith(fakeHub({}, false).hub), key, p)
    const j = (await res.json()) as IngestResponse
    expect(res.status).toBe(200)
    expect(j.mode).toBe('idle')
    expect(j.ack_seq).toBe(p.seq)
  })

  it('B-08: lần 1 ghi 1 dòng link_state, lần 2 trong 60 giây ghi 0 dòng', async () => {
    const { key } = await seedLink()
    const app = appWith(fakeHub().hub)
    const a = (await (await ingest(app, key, live())).json()) as IngestResponse
    const b = (await (await ingest(app, key, live())).json()) as IngestResponse
    expect(a.mode).toBe('live')
    expect(rows(a)).toBe(1)
    expect(rows(b)).toBe(0)
  })

  it('B-09: barDue ghi 1 dòng equity_m5; lặp lại cùng nến không thêm dòng', async () => {
    const { key } = await seedLink()
    const app = appWith(fakeHub({ barDue: true }).hub)
    await ingest(app, key, live())
    expect(await count('equity_m5')).toBe(1)
    await ingest(app, key, live())
    expect(await count('equity_m5')).toBe(1)
  })

  it('B-10: >20 mẫu và >200 vị thế => 400; body >64 KB => 413', async () => {
    const { key } = await seedLink()
    const app = appWith(fakeHub().hub)
    const many = Array.from({ length: 21 }, (_, i) => sample({ t: now() + i }))
    expect((await ingest(app, key, live({ samples: many }))).status).toBe(400)
    const pos = {
      ticket: 1,
      symbol: 'XAUUSD',
      type: 'buy',
      volume: 0.1,
      time: 1,
      price: 1,
    }
    const tooMany = Array.from({ length: 201 }, (_, i) => ({ ...pos, ticket: i }))
    expect((await ingest(app, key, live({ positions: tooMany }))).status).toBe(400)
    expect((await ingest(app, key, 'x'.repeat(70 * 1024))).status).toBe(413)
  })

  it('B-11: trùng sid/seq => duplicate, 0 dòng ghi, không phát lại', async () => {
    const { key } = await seedLink()
    const { hub } = fakeHub({ duplicate: true })
    const j = (await (await ingest(appWith(hub), key, live())).json()) as IngestResponse
    expect(j.duplicate).toBe(true)
    expect(await count('link_state')).toBe(0)
  })

  it('B-13: hub báo quá nhanh => 429 kèm Retry-After: 2', async () => {
    const { key } = await seedLink()
    const res = await ingest(
      appWith(fakeHub({ rateLimited: true, retryAfterSec: 2 }).hub),
      key,
      live(),
    )
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('2')
  })

  it('B-14: pos_hash không đổi không ghi lại positions; đổi thì ghi', async () => {
    const { key, id } = await seedLink()
    const pos = (price: number) => [
      { ticket: 7, symbol: 'XAUUSD', type: 'buy', volume: 0.1, time: 1, price },
    ]
    const stored = async () =>
      (
        await env.DB.prepare('SELECT positions_json AS p FROM link_state WHERE link_id = ?')
          .bind(id)
          .first<{ p: string }>()
      )?.p
    await ingest(appWith(fakeHub({ posChanged: true }).hub), key, live({ positions: pos(1) }))
    const before = await stored()
    const same = (await (
      await ingest(appWith(fakeHub({ posChanged: false }).hub), key, live({ positions: pos(2) }))
    ).json()) as IngestResponse
    expect(rows(same)).toBe(0)
    expect(await stored()).toBe(before)
    const changed = (await (
      await ingest(appWith(fakeHub({ posChanged: true }).hub), key, live({ positions: pos(3) }))
    ).json()) as IngestResponse
    expect(rows(changed)).toBe(1)
    expect(await stored()).not.toBe(before)
  })

  it('B-15: backfill 288 nến ghi <= 288 dòng; gửi lại không thêm; 289 => 400', async () => {
    const { key } = await seedLink()
    const app = appWith(fakeHub().hub)
    const bars = (len: number) =>
      Array.from({ length: len }, (_, i) => ({ t: now() - (i + 1) * 300, eq: 1, bal: 1, fl: 0 }))
    const body = () => live({ reason: ['backfill'], samples: [], bars: bars(288) })
    await ingest(app, key, body())
    const first = await count('equity_m5')
    expect(first).toBeLessThanOrEqual(288)
    expect(first).toBeGreaterThanOrEqual(287) // lệch tối đa 1 do làm tròn nến theo giờ chạy
    await ingest(app, key, body())
    expect(await count('equity_m5')).toBe(first)
    expect((await ingest(app, key, live({ reason: ['backfill'], bars: bars(289) }))).status).toBe(
      400,
    )
  })

  it('B-16: sự kiện giao dịch trong live được upsert vào trades', async () => {
    const { key } = await seedLink()
    const ev = tradeEvent({ kind: 'close', deal_ticket: 9, position_id: 77, profit: 5 })
    await ingest(appWith(fakeHub().hub), key, live({ events: [ev] }))
    expect(await count('trades', 'ticket = 77')).toBe(1)
  })

  it('B-17: interval/poll cấu hình bị kẹp vào biên', () => {
    expect(liveConfig({ LIVE_INTERVAL_SEC: '1' }).intervalSec).toBe(3)
    expect(liveConfig({ LIVE_INTERVAL_SEC: '99' }).intervalSec).toBe(30)
    expect(liveConfig({}).intervalSec).toBe(10)
    expect(liveConfig({ GATE_POLL_SEC: '5' }).pollSec).toBe(30)
    expect(liveConfig({ GATE_POLL_SEC: '9999' }).pollSec).toBe(600)
    expect(liveConfig({}).pollSec).toBe(120)
  })

  it('B-18: payload kiểu AZ_Spike (không có trường live) vẫn 200', async () => {
    const { key } = await seedLink()
    const res = await ingest(appWith(fakeHub().hub), key, makePayload({ reason: ['heartbeat'] }))
    expect(res.status).toBe(200)
  })

  it('B-29: liên kết bị khóa giữa lúc live => 403 và không gọi hub.publish', async () => {
    const { key, id } = await seedLink()
    const { hub, calls } = fakeHub()
    const app = appWith(hub)
    expect((await ingest(app, key, live())).status).toBe(200)
    await env.DB.prepare("UPDATE ea_links SET status = 'disabled' WHERE id = ?").bind(id).run()
    const before = calls.publish
    expect((await ingest(app, key, live())).status).toBe(403)
    expect(calls.publish).toBe(before)
  })

  it('hub lỗi: EA nhận idle nhưng sự kiện giao dịch vẫn được ghi (không mất)', async () => {
    const { key } = await seedLink()
    const ev = tradeEvent({ kind: 'close', deal_ticket: 3, position_id: 88, profit: 1 })
    const res = await ingest(appWith(fakeHub(new Error('x')).hub), key, live({ events: [ev] }))
    expect(res.status).toBe(200)
    expect(((await res.json()) as IngestResponse).mode).toBe('idle')
    expect(await count('trades', 'ticket = 88')).toBe(1)
  })

  it('hub chậm quá 1,5 giây bị coi là lỗi (fail-closed)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    try {
      const { key } = await seedLink()
      const hang: HubClient = { ...fakeHub().hub, publish: () => new Promise(() => {}) }
      const pending = ingest(appWith(hang), key, live())
      await vi.advanceTimersByTimeAsync(2000)
      expect(((await (await pending).json()) as IngestResponse).mode).toBe('idle')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('normalizeSamples (B-12, quy tắc 5)', () => {
  it('dùng giờ nhận khi t lệch quá 120 giây; bỏ mẫu không tăng dần', () => {
    const t0 = 1_800_000_000
    const s = (t: number) => ({ t, eq: 1, bal: 1, fl: 0 })
    const out = normalizeSamples([s(t0 - 5), s(t0 - 5), s(t0 + 500), s(t0 - 100)], t0)
    expect(out.map((x) => x.t)).toEqual([t0 - 5, t0])
  })
})
