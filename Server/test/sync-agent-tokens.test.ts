import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ServerNode, SyncApply, SyncTokenRow } from '@az-sentinel/shared'
import { describe, expect, it } from 'vitest'
import { sha256Hex } from '../../BE/src/lib/crypto'
import { createToken, revokeToken } from '../../BE/src/services/gw-token-service'
import { runMigrations } from '../src/migrate'
import { openDatabase } from '../src/shim/d1'
import { SyncAgent } from '../src/sync-agent'

const migrations = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../BE/migrations')
const asD1 = (db: ReturnType<typeof openDatabase>) => db as unknown as D1Database
const hex = (c: string) => c.repeat(64)

const node = { role: 'vps', name: 'VPS' } as unknown as ServerNode
const noop = () => {}
const log = { debug: noop, info: noop, warn: noop, error: noop }

/** Cloudflare giả: ghi lại các lô `apply`, trả token đã định cho `/api/sync/tokens`. */
function fakeCloud(cfTokens: SyncTokenRow[] = []) {
  const applied: SyncApply[] = []
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    const ok = (body: unknown) => Response.json(body)
    if (url.pathname === '/api/sync/links') return ok({ links: [], next: null })
    if (url.pathname === '/api/sync/trades') return ok({ trades: [], next: null })
    if (url.pathname === '/api/sync/tokens') return ok({ tokens: cfTokens, next: null })
    if (url.pathname === '/api/sync/apply') {
      applied.push(JSON.parse(String(init?.body)) as SyncApply)
      return ok({ applied: 1 })
    }
    return ok({ ok: true })
  }) as typeof fetch
  return { fetchFn, applied }
}

function setup(cloud: ReturnType<typeof fakeCloud>) {
  const db = openDatabase(':memory:')
  runMigrations(db, migrations)
  const agent = new SyncAgent(db, {
    cloudOrigin: 'https://cf.test',
    token: 'sync',
    describe: () => node,
    log,
    fetchFn: cloud.fetchFn,
  })
  const boot = () => (agent as unknown as { boot: () => Promise<void> }).boot()
  return { db, agent, boot }
}

const pushedTokens = (c: ReturnType<typeof fakeCloud>) => c.applied.flatMap((a) => a.tokens)
const outboxTokens = (db: ReturnType<typeof openDatabase>) =>
  Number(
    (
      db.sqlite.prepare("SELECT COUNT(*) AS n FROM sync_outbox WHERE kind = 'token'").get() as {
        n: number
      }
    ).n,
  )

describe('SyncAgent: token Gateway', () => {
  it('đẩy token VPS sang Cloudflare: đủ cột đồng bộ, không có last_used_at, hàng đợi sạch', async () => {
    const cloud = fakeCloud()
    const { db, boot } = setup(cloud)
    const { row } = await createToken(asD1(db), { ownerId: 7, label: 'An' }, 100)
    db.sqlite.prepare('UPDATE gw_tokens SET last_used_at = 999 WHERE id = ?').run(row.id)
    await boot()
    const sent = pushedTokens(cloud)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ id: row.id, owner_id: 7, token_hash: row.token_hash })
    expect(sent[0]).not.toHaveProperty('last_used_at')
    expect(outboxTokens(db)).toBe(0)
  })

  it('lần đầu nhận token từ Cloudflare nhưng không đè token VPS của cùng người', async () => {
    const cf: SyncTokenRow[] = [
      {
        id: 1,
        owner_id: 7,
        label: 'CF',
        token_hash: hex('c'),
        token_prefix: 'azt_cf',
        status: 'active',
        created_at: 50,
        revoked_at: null,
      },
      {
        id: 2,
        owner_id: 8,
        label: 'CF2',
        token_hash: hex('d'),
        token_prefix: 'azt_cf2',
        status: 'active',
        created_at: 60,
        revoked_at: null,
      },
    ]
    const cloud = fakeCloud(cf)
    const { db, boot } = setup(cloud)
    const { token } = await createToken(asD1(db), { ownerId: 7, label: 'An' }, 100)
    await boot()
    const active = db.sqlite
      .prepare(
        "SELECT owner_id, token_hash FROM gw_tokens WHERE status = 'active' ORDER BY owner_id",
      )
      .all() as { owner_id: number; token_hash: string }[]
    expect(active).toHaveLength(2)
    expect(active[0]?.token_hash).toBe(await sha256Hex(token))
    expect(active[1]).toMatchObject({ owner_id: 8, token_hash: hex('d') })
  })

  it('VPS đã bootstrap từ bản cũ (chưa có cờ tokens_boot): vẫn đẩy token đang có', async () => {
    const cloud = fakeCloud()
    const { db, boot } = setup(cloud)
    db.sqlite.exec(
      "INSERT OR REPLACE INTO sync_state (k, v) VALUES ('bootstrap', 'done'), ('last_pull_at', '1')",
    )
    await createToken(asD1(db), { ownerId: 7, label: 'An' }, 100)
    db.sqlite.exec('DELETE FROM sync_outbox') // giả lập: hàng đợi cũ đã mất
    await boot()
    expect(pushedTokens(cloud)).toHaveLength(1)
    expect(
      (db.sqlite.prepare("SELECT v FROM sync_state WHERE k = 'tokens_boot'").get() as { v: string })
        .v,
    ).toBe('done')
  })

  it('thu hồi sau khi đã đồng bộ: lần flush sau gửi trạng thái revoked', async () => {
    const cloud = fakeCloud()
    const { db, agent, boot } = setup(cloud)
    const { row } = await createToken(asD1(db), { ownerId: 7, label: 'An' }, 100)
    await boot()
    await revokeToken(asD1(db), row.id, 200)
    expect(outboxTokens(db)).toBe(1)
    await agent.flush()
    expect(pushedTokens(cloud).at(-1)).toMatchObject({
      id: row.id,
      status: 'revoked',
      revoked_at: 200,
    })
    expect(outboxTokens(db)).toBe(0)
  })

  it('Cloudflare chưa tới được: token giữ trong hàng đợi để gửi lại', async () => {
    const down = (async () => {
      throw new Error('mất mạng')
    }) as unknown as typeof fetch
    const db = openDatabase(':memory:')
    runMigrations(db, migrations)
    const agent = new SyncAgent(db, {
      cloudOrigin: 'https://cf.test',
      token: 'sync',
      describe: () => node,
      log,
      fetchFn: down,
    })
    await createToken(asD1(db), { ownerId: 7, label: 'An' }, 100)
    await agent.flush()
    expect(outboxTokens(db)).toBe(1)
  })
})

describe('SyncAgent: địa chỉ Quick Tunnel trong nhịp sống (Plan 3G)', () => {
  function heartbeatBodies(tunnelUrl?: () => string | null, fail = 0) {
    const bodies: Record<string, unknown>[] = []
    let left = fail
    const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
      if (new URL(String(input)).pathname === '/api/sync/heartbeat') {
        bodies.push(JSON.parse(String(init?.body)))
        if (left-- > 0) return new Response('x', { status: 503 })
      }
      return Response.json({ ok: true })
    }) as typeof fetch
    const db = openDatabase(':memory:')
    runMigrations(db, migrations)
    const agent = new SyncAgent(db, {
      cloudOrigin: 'https://cf.test',
      token: 'sync',
      describe: () => node,
      tunnelUrl,
      log,
      fetchFn,
    })
    return { agent, bodies }
  }

  it('không dùng Quick Tunnel: gửi tunnelUrl = null để Worker bỏ địa chỉ cũ', async () => {
    const { agent, bodies } = heartbeatBodies()
    expect(await agent.heartbeat()).toBe(true)
    expect(bodies[0]).toHaveProperty('tunnelUrl', null)
  })

  it('có địa chỉ tunnel: gửi kèm; chưa có (đang khởi động) thì không gửi để Worker giữ nguyên', async () => {
    const a = heartbeatBodies(() => 'https://abc-def.trycloudflare.com')
    await a.agent.heartbeat()
    expect(a.bodies[0]).toHaveProperty('tunnelUrl', 'https://abc-def.trycloudflare.com')
    const b = heartbeatBodies(() => null)
    await b.agent.heartbeat()
    expect(b.bodies[0]).not.toHaveProperty('tunnelUrl')
  })

  it('deliverTunnel thử lại cho tới khi Worker nhận', async () => {
    const { agent, bodies } = heartbeatBodies(() => 'https://abc-def.trycloudflare.com', 1)
    const wait = globalThis.setTimeout
    globalThis.setTimeout = ((fn: () => void) => wait(fn, 0)) as typeof setTimeout
    try {
      expect(await agent.deliverTunnel(3)).toBe(true)
    } finally {
      globalThis.setTimeout = wait
    }
    expect(bodies).toHaveLength(2)
  })
})
