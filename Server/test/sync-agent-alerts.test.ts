import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ServerNode, SyncApply } from '@az-sentinel/shared'
import { describe, expect, it } from 'vitest'
import { runMigrations } from '../src/migrate'
import { openDatabase } from '../src/shim/d1'
import { SyncAgent } from '../src/sync-agent'

const migrations = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../BE/migrations')
const node = { role: 'vps', name: 'VPS' } as unknown as ServerNode
const noop = () => {}
const log = { debug: noop, info: noop, warn: noop, error: noop }
const NOW = Math.floor(Date.now() / 1000)

type Db = ReturnType<typeof openDatabase>

/** Cloudflare giả: ghi lô `apply`; trả thông báo/trạng thái đợt đã định cho hai endpoint kéo về. */
function fakeCloud(
  opts: { notifications?: unknown[]; states?: unknown[]; failPull?: boolean } = {},
) {
  const applied: SyncApply[] = []
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    const ok = (body: unknown) => Response.json(body)
    if (url.pathname === '/api/sync/links') return ok({ links: [], next: null })
    if (url.pathname === '/api/sync/trades') return ok({ trades: [], next: null })
    if (url.pathname === '/api/sync/tokens') return ok({ tokens: [], next: null })
    if (url.pathname === '/api/sync/notifications') {
      if (opts.failPull) return new Response('x', { status: 404 })
      return ok({ notifications: opts.notifications ?? [], next: null })
    }
    if (url.pathname === '/api/sync/alert-state') return ok({ states: opts.states ?? [] })
    if (url.pathname === '/api/sync/apply') {
      applied.push(JSON.parse(String(init?.body)) as SyncApply)
      return ok({ applied: 1 })
    }
    return ok({ ok: true })
  }) as typeof fetch
  return { fetchFn, applied }
}

function setup(cloud: ReturnType<typeof fakeCloud>) {
  const db: Db = openDatabase(':memory:')
  runMigrations(db, migrations)
  const agent = new SyncAgent(db, {
    cloudOrigin: 'https://cf.test',
    token: 'sync',
    describe: () => node,
    log,
    fetchFn: cloud.fetchFn,
  })
  return { db, agent }
}

const outbox = (db: Db, kind: string) =>
  Number(
    (
      db.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_outbox WHERE kind = ?').get(kind) as {
        n: number
      }
    ).n,
  )

describe('SyncAgent: cảnh báo lỗ float', () => {
  it('trigger: ghi cài đặt, đợt, thông báo thì vào hàng đợi; đánh dấu đã đọc cũng vậy', () => {
    const { db } = setup(fakeCloud())
    db.sqlite
      .prepare(
        "INSERT INTO alert_settings (owner_id, loss_bp, growth_mode, updated_at) VALUES (7, 500, 'float', 1)",
      )
      .run()
    db.sqlite
      .prepare(
        'INSERT INTO alert_state (link_id, episode_open, last_aseq, updated_at) VALUES (3, 1, 9, 1)',
      )
      .run()
    db.sqlite
      .prepare(
        `INSERT INTO notifications (uid, owner_id, kind, title, body, created_at, updated_at)
         VALUES ('uid-aaaaaaaa', 7, 'warn', 't', 'b', ?, ?)`,
      )
      .run(NOW, NOW)
    expect(outbox(db, 'alert_cfg')).toBe(1)
    expect(outbox(db, 'alert_state')).toBe(1)
    expect(outbox(db, 'notif')).toBe(1)

    db.sqlite.prepare('DELETE FROM sync_outbox').run()
    db.sqlite.prepare("UPDATE notifications SET read_at = ? WHERE uid = 'uid-aaaaaaaa'").run(NOW)
    expect(outbox(db, 'notif')).toBe(1)
  })

  it('flush đẩy đủ 3 loại sang Cloudflare, kèm growth_mode, và dọn hàng đợi', async () => {
    const cloud = fakeCloud()
    const { db, agent } = setup(cloud)
    db.sqlite
      .prepare(
        "INSERT INTO alert_settings (owner_id, loss_bp, growth_mode, updated_at) VALUES (7, 500, 'float', 1)",
      )
      .run()
    db.sqlite
      .prepare(
        'INSERT INTO alert_state (link_id, episode_open, last_aseq, updated_at) VALUES (3, 1, 9, 1)',
      )
      .run()
    db.sqlite
      .prepare(
        `INSERT INTO notifications (uid, owner_id, kind, title, body, created_at, updated_at)
         VALUES ('uid-aaaaaaaa', 7, 'warn', 't', 'b', ?, ?)`,
      )
      .run(NOW, NOW)
    await agent.flush()
    const all = cloud.applied
    expect(all.flatMap((a) => a.alert_settings)).toEqual([
      { owner_id: 7, loss_bp: 500, growth_mode: 'float', updated_at: 1 },
    ])
    expect(all.flatMap((a) => a.alert_states)).toHaveLength(1)
    expect(all.flatMap((a) => a.notifications).map((n) => n.uid)).toEqual(['uid-aaaaaaaa'])
    expect(outbox(db, 'alert_cfg') + outbox(db, 'alert_state') + outbox(db, 'notif')).toBe(0)
  })

  it('kéo về: thông báo và trạng thái đợt Cloudflare ghi hộ được áp mà KHÔNG đẩy ngược', async () => {
    const cloud = fakeCloud({
      notifications: [
        {
          uid: 'uid-bbbbbbbb',
          owner_id: 7,
          link_id: null,
          kind: 'warn',
          title: 't',
          body: 'b',
          data_json: null,
          created_at: NOW - 10,
          read_at: null,
          updated_at: NOW - 10,
        },
      ],
      states: [
        {
          link_id: 3,
          episode_open: 1,
          ep_started_at: NOW - 10,
          last_notified_at: NOW - 10,
          last_notified_fl: -5,
          last_aseq: NOW - 10,
          updated_at: NOW - 10,
        },
      ],
    })
    const { db, agent } = setup(cloud)
    expect(await agent.pullAlerts(0)).toBe(true)
    const n = db.sqlite.prepare('SELECT COUNT(*) AS c FROM notifications').get() as { c: number }
    const s = db.sqlite.prepare('SELECT last_aseq FROM alert_state WHERE link_id = 3').get() as {
      last_aseq: number
    }
    expect(Number(n.c)).toBe(1)
    expect(Number(s.last_aseq)).toBe(NOW - 10)
    expect(outbox(db, 'notif')).toBe(0)
    expect(outbox(db, 'alert_state')).toBe(0)
  })

  it('Worker bản cũ (404) thì kéo thất bại nhưng không ném lỗi', async () => {
    const { agent } = setup(fakeCloud({ failPull: true }))
    expect(await agent.pullAlerts(0)).toBe(false)
  })
})
