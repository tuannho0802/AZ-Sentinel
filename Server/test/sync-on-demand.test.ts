import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FAILOVER, type ServerNode } from '@az-sentinel/shared'
import { describe, expect, it } from 'vitest'
import { isVisitorRequest } from '../src/activity'
import { runMigrations } from '../src/migrate'
import { openDatabase } from '../src/shim/d1'
import { SyncAgent } from '../src/sync-agent'

const migrations = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../BE/migrations')
const node = { role: 'vps', name: 'VPS' } as unknown as ServerNode
const noop = () => {}
const log = { debug: noop, info: noop, warn: noop, error: noop }
const IDLE_MS = FAILOVER.visitorIdleSec * 1000

function setup(onDemand: boolean) {
  const paths: string[] = []
  const fetchFn = (async (input: string | URL | Request) => {
    paths.push(new URL(String(input)).pathname)
    return Response.json({ ok: true })
  }) as typeof fetch
  const clock = { t: 1_000_000 }
  const db = openDatabase(':memory:')
  runMigrations(db, migrations)
  const agent = new SyncAgent(db, {
    cloudOrigin: 'https://cf.test',
    token: 'sync',
    describe: () => node,
    log,
    fetchFn,
    onDemand,
    now: () => clock.t,
  })
  const beats = () => paths.filter((p) => p === '/api/sync/heartbeat').length
  const drain = () => new Promise((r) => setTimeout(r, 20))
  const shouldFlush = () => (agent as unknown as { shouldFlush(): boolean }).shouldFlush()
  return { agent, clock, beats, drain, shouldFlush }
}

describe('heartbeat và đồng bộ theo người truy cập (Plan 3J)', () => {
  it('không bật onDemand: luôn coi là có người, touch không làm gì', async () => {
    const t = setup(false)
    expect(t.agent.hasVisitors()).toBe(true)
    t.agent.touch()
    await t.drain()
    expect(t.beats()).toBe(0)
    expect(t.shouldFlush()).toBe(true)
  })

  it('chưa ai vào: không có người, không xả theo nhịp sau lần xả nốt', () => {
    const t = setup(true)
    expect(t.agent.hasVisitors()).toBe(false)
    expect(t.shouldFlush()).toBe(true) // xả nốt một lần (hàng đợi lúc khởi động)
    expect(t.shouldFlush()).toBe(false)
    expect(t.shouldFlush()).toBe(false)
  })

  it('người đầu tiên vào: báo nhịp sống ngay; người tiếp theo cùng đợt thì không báo thêm', async () => {
    const t = setup(true)
    t.agent.touch()
    await t.drain()
    expect(t.agent.hasVisitors()).toBe(true)
    expect(t.beats()).toBe(1)
    t.clock.t += 60_000
    t.agent.touch()
    await t.drain()
    expect(t.beats()).toBe(1)
  })

  it('vắng người quá hạn: xả nốt đúng một lần rồi nghỉ; có người lại thì báo nhịp sống lần nữa', async () => {
    const t = setup(true)
    t.agent.touch()
    await t.drain()
    expect(t.shouldFlush()).toBe(true)
    t.clock.t += IDLE_MS + 1
    expect(t.agent.hasVisitors()).toBe(false)
    expect(t.shouldFlush()).toBe(true)
    expect(t.shouldFlush()).toBe(false)
    t.agent.touch()
    await t.drain()
    expect(t.beats()).toBe(2)
    expect(t.shouldFlush()).toBe(true)
  })
})

describe('isVisitorRequest', () => {
  it('trang, tệp tĩnh và API của người xem tính là người truy cập', () => {
    for (const p of [
      '/',
      '/links/3',
      '/assets/index-abc.js',
      '/api/me',
      '/api/links',
      '/api/server-info',
      '/api/live/ws',
    ]) {
      expect(isVisitorRequest(p), p).toBe(true)
    }
  })

  it('Gateway, EA, health, đồng bộ không tính', () => {
    for (const p of [
      '/api/health',
      '/api/gw/ws',
      '/api/gw/tunnel',
      '/api/ea/v1/ingest',
      '/api/sync/heartbeat',
      '/api/dev/links',
    ]) {
      expect(isVisitorRequest(p), p).toBe(false)
    }
  })
})
