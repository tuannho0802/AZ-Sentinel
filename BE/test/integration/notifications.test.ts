import { env } from 'cloudflare:workers'
import type { AlertSettings, NotificationListResponse, SyncApply } from '@az-sentinel/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app'
import {
  loadAlertSettings,
  processAlertReport,
  saveAlertSettings,
} from '../../src/services/alert-service'
import {
  applySync,
  readAlertStatesSince,
  readNotificationsSince,
} from '../../src/services/sync-service'
import {
  count,
  LOGIN,
  resetDb,
  SERVER,
  seedLink,
  seedUser,
  setOwner,
  TEST_PASSWORD,
} from '../helpers'

const app = createApp()
const bindings = { DB: env.DB, LIVE_HUB: env.LIVE_HUB }

function call(method: string, path: string, cookie: string | null, body?: unknown) {
  return app.fetch(
    new Request(`http://az.test/api${path}`, {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    bindings,
  )
}

async function loginAs(email: string): Promise<string> {
  const res = await call('POST', '/auth/login', null, { email, password: TEST_PASSWORD })
  expect(res.status).toBe(200)
  return (res.headers.get('Set-Cookie') ?? '').split(';')[0] ?? ''
}

const T0 = 1_760_000_000
const report = (over: Record<string, unknown> = {}) =>
  ({
    aseq: T0,
    kind: 'breach' as const,
    ts: T0,
    bal: 10_000,
    eq: 9_000,
    fl: -1_000,
    n: 2,
    ccy: 'USC',
    ...over,
  }) as Parameters<typeof processAlertReport>[2]

const TID = `${LOGIN}@${SERVER}`
const emptySync: SyncApply = {
  users: [],
  tokens: [],
  links: [],
  links_deleted: [],
  trades: [],
  trades_deleted: [],
  alert_settings: [],
  alert_states: [],
  notifications: [],
}

beforeEach(resetDb)

describe('/api/settings/alerts', () => {
  it('chưa đăng nhập 401; mặc định tắt và chế độ balance', async () => {
    expect((await call('GET', '/settings/alerts', null)).status).toBe(401)
    expect((await call('PUT', '/settings/alerts', null, { loss_pct: 5 })).status).toBe(401)
    await seedUser('a@az.test')
    const a = await loginAs('a@az.test')
    const res = await call('GET', '/settings/alerts', a)
    expect(await res.json<AlertSettings>()).toEqual({ loss_pct: 0, growth_mode: 'balance' })
  })

  it('đặt ngưỡng và chuyển qua lại giữa hai chế độ; không gửi growth_mode thì giữ chế độ cũ', async () => {
    await seedUser('a@az.test')
    const a = await loginAs('a@az.test')
    let r = await call('PUT', '/settings/alerts', a, { loss_pct: 5 })
    expect(await r.json<AlertSettings>()).toEqual({ loss_pct: 5, growth_mode: 'balance' })
    r = await call('PUT', '/settings/alerts', a, { loss_pct: 5, growth_mode: 'float' })
    expect(await r.json<AlertSettings>()).toEqual({ loss_pct: 5, growth_mode: 'float' })
    r = await call('PUT', '/settings/alerts', a, { loss_pct: 7.5 })
    expect(await r.json<AlertSettings>()).toEqual({ loss_pct: 7.5, growth_mode: 'float' })
    r = await call('PUT', '/settings/alerts', a, { loss_pct: 7.5, growth_mode: 'balance' })
    expect(await r.json<AlertSettings>()).toEqual({ loss_pct: 7.5, growth_mode: 'balance' })
    expect(await (await call('GET', '/settings/alerts', a)).json<AlertSettings>()).toEqual({
      loss_pct: 7.5,
      growth_mode: 'balance',
    })
  })

  it('0 là tắt; giá trị sai trả 400', async () => {
    await seedUser('a@az.test')
    const a = await loginAs('a@az.test')
    expect((await call('PUT', '/settings/alerts', a, { loss_pct: 0 })).status).toBe(200)
    for (const bad of [
      { loss_pct: 0.05 },
      { loss_pct: -1 },
      { loss_pct: 101 },
      { loss_pct: 'x' },
      { loss_pct: 5, growth_mode: 'khac' },
      {},
    ]) {
      expect((await call('PUT', '/settings/alerts', a, bad)).status).toBe(400)
    }
  })

  it('cài đặt theo từng người', async () => {
    await seedUser('a@az.test')
    await seedUser('b@az.test')
    const [a, b] = [await loginAs('a@az.test'), await loginAs('b@az.test')]
    await call('PUT', '/settings/alerts', a, { loss_pct: 5, growth_mode: 'float' })
    expect(await (await call('GET', '/settings/alerts', b)).json<AlertSettings>()).toEqual({
      loss_pct: 0,
      growth_mode: 'balance',
    })
  })
})

describe('processAlertReport và /api/notifications', () => {
  async function setup() {
    const a = await seedUser('a@az.test')
    const b = await seedUser('b@az.test')
    const link = await seedLink()
    await setOwner(link.id, a.id)
    return { a, b, linkId: link.id, ownerId: a.id }
  }

  it('warn rồi im lặng trong 1 tiếng; ghi 1 thông báo, idempotent khi gửi lại', async () => {
    const { linkId, ownerId } = await setup()
    await saveAlertSettings(env.DB, ownerId, 500, 'balance', 1)
    const term = { linkId, ownerId, tid: TID }
    expect(await processAlertReport(env.DB, term, report(), T0)).toBe('warn')
    expect(await processAlertReport(env.DB, term, report(), T0)).toBeNull() // gửi lại
    expect(await processAlertReport(env.DB, term, report({ aseq: T0 + 60 }), T0 + 60)).toBeNull()
    expect(await count('notifications')).toBe(1)
  })

  it('increase theo chế độ đã lưu; clear báo ngay và đóng đợt', async () => {
    const { linkId, ownerId } = await setup()
    await saveAlertSettings(env.DB, ownerId, 500, 'balance', 1)
    const term = { linkId, ownerId, tid: TID }
    await processAlertReport(env.DB, term, report(), T0)
    const later = T0 + 3600 + 300
    expect(await processAlertReport(env.DB, term, report({ aseq: later, fl: -1_200 }), later)).toBe(
      'increase',
    )
    expect(
      await processAlertReport(
        env.DB,
        term,
        report({ aseq: later + 10, kind: 'clear', n: 0, closed_pl: -1_300 }),
        later + 10,
      ),
    ).toBe('clear')
    const row = await env.DB.prepare('SELECT episode_open FROM alert_state WHERE link_id = ?')
      .bind(linkId)
      .first<{ episode_open: number }>()
    expect(row?.episode_open).toBe(0)
    expect(await count('notifications')).toBe(3)
  })

  it('đổi chế độ giữa chừng: báo cáo kế tiếp tính theo chế độ mới', async () => {
    const { linkId, ownerId } = await setup()
    const term = { linkId, ownerId, tid: TID }
    await saveAlertSettings(env.DB, ownerId, 500, 'balance', 1)
    await processAlertReport(env.DB, term, report(), T0)
    const later = T0 + 7200
    // -1000 -> -1050: 0,5% Balance (im lặng) nhưng 5% theo Float P/L (báo)
    await saveAlertSettings(env.DB, ownerId, 500, 'float', 2)
    expect(await processAlertReport(env.DB, term, report({ aseq: later, fl: -1_050 }), later)).toBe(
      'increase',
    )
  })

  it('tắt cảnh báo thì không có thông báo', async () => {
    const { linkId, ownerId } = await setup()
    await processAlertReport(env.DB, { linkId, ownerId, tid: TID }, report(), T0)
    expect(await count('notifications')).toBe(0)
  })

  it('danh sách và đánh dấu đã đọc chỉ trong phạm vi của chính người đó', async () => {
    const { linkId, ownerId } = await setup()
    await saveAlertSettings(env.DB, ownerId, 500, 'balance', 1)
    await processAlertReport(env.DB, { linkId, ownerId, tid: TID }, report(), T0)
    const [a, b] = [await loginAs('a@az.test'), await loginAs('b@az.test')]

    const mine = await (await call('GET', '/notifications', a)).json<NotificationListResponse>()
    expect(mine.unread).toBe(1)
    expect(mine.items).toHaveLength(1)
    expect(mine.items[0]).toMatchObject({ kind: 'warn', read: false, link_id: linkId })
    const other = await (await call('GET', '/notifications', b)).json<NotificationListResponse>()
    expect(other).toEqual({ items: [], unread: 0 })

    const id = mine.items[0]?.id ?? ''
    // người khác đánh dấu không có tác dụng
    await call('POST', '/notifications/read', b, { ids: [id] })
    expect(
      (await (await call('GET', '/notifications', a)).json<NotificationListResponse>()).unread,
    ).toBe(1)
    const done = await call('POST', '/notifications/read', a, { ids: [id] })
    expect(await done.json()).toEqual({ unread: 0 })
    const unreadOnly = await (
      await call('GET', '/notifications?unread=1', a)
    ).json<NotificationListResponse>()
    expect(unreadOnly.items).toHaveLength(0)
  })

  it('401 khi chưa đăng nhập; 400 khi thân sai; read all hoạt động', async () => {
    const { linkId, ownerId } = await setup()
    expect((await call('GET', '/notifications', null)).status).toBe(401)
    expect((await call('POST', '/notifications/read', null, { all: true })).status).toBe(401)
    const a = await loginAs('a@az.test')
    expect((await call('POST', '/notifications/read', a, { ids: [] })).status).toBe(400)
    expect((await call('POST', '/notifications/read', a, {})).status).toBe(400)
    await saveAlertSettings(env.DB, ownerId, 500, 'balance', 1)
    await processAlertReport(env.DB, { linkId, ownerId, tid: TID }, report(), T0)
    const r = await call('POST', '/notifications/read', a, { all: true })
    expect(await r.json()).toEqual({ unread: 0 })
  })

  it('giữ tối đa 500 thông báo mỗi người', async () => {
    const { ownerId } = await setup()
    const stmts = []
    for (let i = 0; i < 520; i++) {
      stmts.push(
        env.DB.prepare(
          `INSERT INTO notifications (uid, owner_id, link_id, kind, title, body, created_at, updated_at)
           VALUES (?, ?, NULL, 'warn', 't', 'b', ?, ?)`,
        ).bind(
          `uid-${String(i).padStart(8, '0')}`,
          ownerId,
          Math.floor(Date.now() / 1000) - 1000 + i,
          1,
        ),
      )
    }
    await env.DB.batch(stmts)
    await saveAlertSettings(env.DB, ownerId, 500, 'balance', 1)
    const link = await seedLink({ login: 999 })
    await setOwner(link.id, ownerId)
    await processAlertReport(
      env.DB,
      { linkId: link.id, ownerId, tid: `999@${SERVER}` },
      report(),
      Math.floor(Date.now() / 1000),
    )
    expect(await count('notifications')).toBe(500)
  })
})

describe('đồng bộ VPS <-> Cloudflare cho thông báo', () => {
  // Mốc gần hiện tại: thông báo quá 30 ngày bị dọn ngay khi đồng bộ.
  const NOW = Math.floor(Date.now() / 1000)
  const notif = (over: Record<string, unknown> = {}) => ({
    uid: 'uid-aaaaaaaa',
    owner_id: 5,
    link_id: null,
    kind: 'warn' as const,
    title: 't',
    body: 'b',
    data_json: null,
    created_at: NOW - 100,
    read_at: null,
    updated_at: NOW - 100,
    ...over,
  })

  it('cài đặt: VPS ghi đè, kể cả chế độ; dòng thiếu chế độ mặc định là balance', async () => {
    await applySync(env.DB, {
      ...emptySync,
      alert_settings: [{ owner_id: 5, loss_bp: 500, growth_mode: 'float', updated_at: 10 }],
    })
    expect(await loadAlertSettings(env.DB, 5)).toEqual({ bp: 500, mode: 'float' })
    await applySync(env.DB, {
      ...emptySync,
      alert_settings: [{ owner_id: 5, loss_bp: 300, growth_mode: 'balance', updated_at: 20 }],
    })
    expect(await loadAlertSettings(env.DB, 5)).toEqual({ bp: 300, mode: 'balance' })
  })

  it('thông báo: read_at lấy MAX, nội dung không bị ghi đè, đẩy lại không nhân đôi', async () => {
    await applySync(env.DB, { ...emptySync, notifications: [notif()] })
    await applySync(env.DB, {
      ...emptySync,
      notifications: [notif({ read_at: NOW - 50, updated_at: NOW - 50 })],
    })
    await applySync(env.DB, {
      ...emptySync,
      notifications: [notif({ title: 'khác', read_at: null, updated_at: NOW - 80 })],
    })
    expect(await count('notifications')).toBe(1)
    const row = await env.DB.prepare('SELECT title, read_at FROM notifications').first<{
      title: string
      read_at: number | null
    }>()
    expect(row).toEqual({ title: 't', read_at: NOW - 50 })
  })

  it('alert_state: bản updated_at mới hơn thắng, bản cũ không làm lùi trạng thái', async () => {
    const st = (over: Record<string, unknown>) => ({
      link_id: 3,
      episode_open: 1,
      ep_started_at: 100,
      last_notified_at: 100,
      last_notified_fl: -10,
      last_aseq: 100,
      updated_at: 100,
      ...over,
    })
    await applySync(env.DB, {
      ...emptySync,
      alert_states: [st({ updated_at: 200, last_aseq: 200 })],
    })
    await applySync(env.DB, {
      ...emptySync,
      alert_states: [st({ updated_at: 100, last_aseq: 100 })],
    })
    const row = await env.DB.prepare('SELECT last_aseq FROM alert_state WHERE link_id = 3').first<{
      last_aseq: number
    }>()
    expect(row?.last_aseq).toBe(200)
  })

  it('Cloudflare đọc lại thông báo và trạng thái đợt đã ghi từ một mốc', async () => {
    await applySync(env.DB, {
      ...emptySync,
      notifications: [
        notif({ uid: 'uid-00000001', updated_at: NOW - 5000 }),
        notif({ uid: 'uid-00000002', updated_at: NOW - 10 }),
      ],
      alert_states: [
        {
          link_id: 3,
          episode_open: 1,
          ep_started_at: 1,
          last_notified_at: 1,
          last_notified_fl: -5,
          last_aseq: 1,
          updated_at: NOW - 10,
        },
      ],
    })
    const page = await readNotificationsSince(env.DB, NOW - 1000, 0, 10)
    expect(page.notifications.map((n) => n.uid)).toEqual(['uid-00000002'])
    expect(page.next).toBeNull()
    expect((await readAlertStatesSince(env.DB, NOW - 1000)).states).toHaveLength(1)
    expect((await readAlertStatesSince(env.DB, NOW)).states).toHaveLength(0)
  })
})
