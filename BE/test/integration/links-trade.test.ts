import { env } from 'cloudflare:workers'
import { type GwServerMessage, terminalId } from '@az-sentinel/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app'
import { encodeGwToken, GW_HEADER, GW_TOKEN_HEADER } from '../../src/live/gw-header'
import { HUB_NAME } from '../../src/live/routes/live-ws'
import { LOGIN, resetDb, SERVER, seedLink, seedUser, setOwner, TEST_PASSWORD } from '../helpers'

const app = createApp()
const bindings = { DB: env.DB, LIVE_HUB: env.LIVE_HUB }
const TID = terminalId(LOGIN, SERVER)
const open: WebSocket[] = []

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

const until = async (fn: () => boolean, ms = 1500) => {
  const end = Date.now() + ms
  while (!fn()) {
    if (Date.now() > end) throw new Error('quá thời gian chờ')
    await new Promise((r) => setTimeout(r, 10))
  }
}
const tick = () => new Promise((r) => setTimeout(r, 40))

/** Gateway giả nối vào đúng hub mà route dùng, terminal đã bind và online. */
async function onlineGateway(key: string, tokenOwner: number) {
  const hub = env.LIVE_HUB.getByName(HUB_NAME)
  const res = await hub.fetch(
    new Request('http://hub/', {
      headers: {
        Upgrade: 'websocket',
        [GW_HEADER]: '1',
        [GW_TOKEN_HEADER]: encodeGwToken(1, tokenOwner),
      },
    }),
  )
  const ws = res.webSocket
  if (!ws) throw new Error('Gateway không nâng cấp được')
  const msgs: GwServerMessage[] = []
  ws.accept()
  ws.addEventListener('message', (e) => {
    const text = String(e.data)
    if (text !== 'pong') msgs.push(JSON.parse(text) as GwServerMessage)
  })
  open.push(ws)
  ws.send(JSON.stringify({ t: 'hello', v: 1, gw_ver: '0.3.4' }))
  ws.send(JSON.stringify({ t: 'bind', tid: TID, key, login: LOGIN, server: SERVER, mode: 'demo' }))
  await until(() => msgs.some((m) => m.t === 'bound'))
  ws.send(
    JSON.stringify({
      t: 'state',
      tid: TID,
      online: true,
      snap: { bal: 1, eq: 1, fl: 0, ml: null },
    }),
  )
  await tick()
  return { ws, msgs }
}

let linkId = 0
let key = ''
let root = ''
let user = ''
let ownerId = 0
const trade = (cookie: string | null, body: unknown, id = linkId) =>
  call('POST', `/links/${id}/trade`, cookie, body)
const row = (cmd: string) =>
  env.DB.prepare('SELECT * FROM trade_log WHERE cmd_id = ?')
    .bind(cmd)
    .first<{ status: string; reason: string | null; user_id: number; op: string; ticket: number }>()

beforeEach(async () => {
  await resetDb()
  await seedUser('root@az.test', { role: 'root_admin' })
  const owner = await seedUser('a@az.test')
  const seeded = await seedLink()
  linkId = seeded.id
  key = seeded.key
  ownerId = owner.id
  await setOwner(linkId, owner.id)
  root = await loginAs('root@az.test')
  user = await loginAs('a@az.test')
})
afterEach(async () => {
  for (const ws of open.splice(0)) {
    try {
      ws.close(1000)
    } catch {
      // đã đóng
    }
  }
  await tick()
})

describe('giao dịch từ xa: quyền và công tắc', () => {
  it('chưa đăng nhập 401; người dùng thường (kể cả chủ liên kết) 403', async () => {
    expect((await trade(null, { op: 'close', ticket: 1 })).status).toBe(401)
    expect((await trade(user, { op: 'close', ticket: 1 })).status).toBe(403)
    expect(
      (await call('POST', `/links/${linkId}/trade-enabled`, user, { enabled: true })).status,
    ).toBe(403)
  })

  it('mặc định tắt: admin gọi bị 403 TRADE_DISABLED; không ghi nhật ký', async () => {
    const res = await trade(root, { op: 'close', ticket: 1 })
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('TRADE_DISABLED')
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM trade_log').first<{ n: number }>()
    expect(n?.n).toBe(0)
  })

  it('admin bật rồi tắt; liên kết trả về cờ trade_enabled', async () => {
    const on = await call('POST', `/links/${linkId}/trade-enabled`, root, { enabled: true })
    expect(on.status).toBe(200)
    expect(((await on.json()) as { trade_enabled: boolean }).trade_enabled).toBe(true)
    const off = await call('POST', `/links/${linkId}/trade-enabled`, root, { enabled: false })
    expect(((await off.json()) as { trade_enabled: boolean }).trade_enabled).toBe(false)
  })

  it('gỡ gắn tài khoản thì tắt giao dịch từ xa', async () => {
    await call('POST', `/links/${linkId}/trade-enabled`, root, { enabled: true })
    await call('POST', `/links/${linkId}/unbind`, root, {})
    const r = await env.DB.prepare('SELECT trade_enabled FROM ea_links WHERE id = ?')
      .bind(linkId)
      .first<{ trade_enabled: number }>()
    expect(r?.trade_enabled).toBe(0)
  })

  it('liên kết đang tắt thì không giao dịch', async () => {
    await call('POST', `/links/${linkId}/trade-enabled`, root, { enabled: true })
    await call('POST', `/links/${linkId}/status`, root, { status: 'disabled' })
    const res = await trade(root, { op: 'close', ticket: 1 })
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('LINK_DISABLED')
  })
})

describe('giao dịch từ xa: kiểm tra thân lệnh', () => {
  beforeEach(async () => {
    await call('POST', `/links/${linkId}/trade-enabled`, root, { enabled: true })
  })

  it.each([
    ['thiếu op', {}],
    ['op lạ', { op: 'buy', ticket: 1 }],
    ['ticket 0', { op: 'close', ticket: 0 }],
    ['ticket âm', { op: 'close', ticket: -5 }],
    ['partial thiếu volume', { op: 'partial_close', ticket: 1 }],
    ['partial volume 0', { op: 'partial_close', ticket: 1, volume: 0 }],
    ['partial volume âm', { op: 'partial_close', ticket: 1, volume: -1 }],
    ['modify thiếu tp', { op: 'modify', ticket: 1, sl: 1 }],
    ['modify giá âm', { op: 'modify', ticket: 1, sl: -1, tp: 0 }],
  ])('%s -> 400, không ghi nhật ký', async (_name, body) => {
    expect((await trade(root, body)).status).toBe(400)
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM trade_log').first<{ n: number }>()
    expect(n?.n).toBe(0)
  })

  it('liên kết không tồn tại 404', async () => {
    expect((await trade(root, { op: 'close', ticket: 1 }, linkId + 999)).status).toBe(404)
  })
})

describe('giao dịch từ xa: phiên bản EA', () => {
  const setEa = (v: string | null) =>
    env.DB.prepare(
      `INSERT INTO link_state (link_id, last_seen_at, ea_ver) VALUES (?, 1, ?)
       ON CONFLICT(link_id) DO UPDATE SET ea_ver = excluded.ea_ver`,
    )
      .bind(linkId, v)
      .run()

  beforeEach(async () => {
    await call('POST', `/links/${linkId}/trade-enabled`, root, { enabled: true })
  })

  it('EA cũ hơn 0.5.0: 409 ngay, không ghi nhật ký', async () => {
    await setEa('0.4.0')
    const res = await trade(root, { op: 'close', ticket: 1 })
    expect(res.status).toBe(409)
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM trade_log').first<{ n: number }>()
    expect(n?.n).toBe(0)
  })

  it('EA 0.5.0 trở lên không bị chặn ở bước này (offline thì 409 TRADE_BUSY như thường)', async () => {
    await setEa('0.5.0')
    const res = await trade(root, { op: 'close', ticket: 1 })
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('TRADE_BUSY')
  })
})

describe('giao dịch từ xa: gửi lệnh', () => {
  beforeEach(async () => {
    await call('POST', `/links/${linkId}/trade-enabled`, root, { enabled: true })
  })

  it('terminal offline: 409 TRADE_BUSY và nhật ký ghi failed/terminal_offline', async () => {
    const res = await trade(root, { op: 'close', ticket: 777 })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('TRADE_BUSY')
    const log = await env.DB.prepare('SELECT status, reason FROM trade_log').first<{
      status: string
      reason: string
    }>()
    expect(log).toEqual({ status: 'failed', reason: 'terminal_offline' })
  })

  it('terminal online: 202 kèm cmd_id, Gateway nhận lệnh, nhật ký ghi sent kèm người gửi', async () => {
    const g = await onlineGateway(key, ownerId)
    const res = await trade(root, { op: 'partial_close', ticket: 777, volume: 0.02 })
    expect(res.status).toBe(202)
    const body = (await res.json()) as { cmd_id: string; op: string; ticket: number }
    expect(body.cmd_id).toMatch(/^[0-9a-f]{16}$/)
    await until(() => g.msgs.some((m) => m.t === 'trade'))
    expect(g.msgs.find((m) => m.t === 'trade')).toMatchObject({
      tid: TID,
      cmd_id: body.cmd_id,
      op: 'partial_close',
      ticket: 777,
      volume: 0.02,
    })
    expect(await row(body.cmd_id)).toMatchObject({
      status: 'sent',
      op: 'partial_close',
      ticket: 777,
    })
  })

  it('lệnh trước chưa có kết quả thì lệnh mới bị 409; có kết quả rồi thì gửi tiếp được', async () => {
    const g = await onlineGateway(key, ownerId)
    const first = (await (await trade(root, { op: 'close', ticket: 1 })).json()) as {
      cmd_id: string
    }
    const busy = await trade(root, { op: 'close', ticket: 2 })
    expect(busy.status).toBe(409)
    expect(((await busy.json()) as { error: { code: string } }).error.code).toBe('TRADE_BUSY')

    g.ws.send(
      JSON.stringify({
        t: 'trade_result',
        tid: TID,
        cmd_id: first.cmd_id,
        status: 'done',
        reason: 'ok',
        code: 10009,
        detail: 'ok',
      }),
    )
    await tick()
    expect((await trade(root, { op: 'close', ticket: 2 })).status).toBe(202)
  })
})
