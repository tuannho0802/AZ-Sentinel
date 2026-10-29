import { env } from 'cloudflare:workers'
import { type GwServerMessage, terminalId } from '@az-sentinel/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app'
import { encodeGwToken, GW_HEADER, GW_TOKEN_HEADER } from '../../src/live/gw-header'
import { isOriginAllowed } from '../../src/live/origin'
import { HUB_NAME } from '../../src/live/routes/live-ws'
import { findSession } from '../../src/services/session-service'
import {
  LOGIN,
  resetDb,
  SERVER,
  seedLink,
  seedToken,
  seedUser,
  setOwner,
  TEST_PASSWORD,
} from '../helpers'

/**
 * Ca hiếm về bảo mật và lỗi thao tác của BE.
 *
 * Quy ước: `it.fails` = hành vi ĐÚNG MONG MUỐN mà code hiện tại chưa đạt (đã chạy xác nhận). Suite vẫn xanh;
 * sửa xong lỗi thì vitest báo "expected to fail but passed" -> đổi `it.fails` thành `it`.
 */

const app = createApp()
const bindings = { DB: env.DB, LIVE_HUB: env.LIVE_HUB }
const TID = terminalId(LOGIN, SERVER)
const open: WebSocket[] = []

function call(
  method: string,
  path: string,
  cookie: string | null,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return app.fetch(
    new Request(`http://az.test/api${path}`, {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    bindings,
  )
}

async function loginAs(email: string, password = TEST_PASSWORD): Promise<string> {
  const res = await call('POST', '/auth/login', null, { email, password })
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
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms))

beforeEach(resetDb)
afterEach(async () => {
  for (const ws of open.splice(0)) {
    try {
      ws.close(1000)
    } catch {
      // đã đóng
    }
  }
  await tick(40)
})

describe('đường dẫn dev/spike còn sót không được lộ ra production', () => {
  // Lỗi 3: app.ts vẫn mount /api/_spike (ghi chú "xóa ở P1-31"). Không cần đăng nhập, mỗi request chạy PBKDF2
  // tới 100.000 vòng: bất kỳ ai cũng đốt CPU của Worker/VPS được, và không có rate limit nào chặn lại.
  it.fails('/api/_spike/hash không tồn tại khi không bật cờ dev (DEV_LINKS_API != 1)', async () => {
    const res = await app.fetch(new Request('http://az.test/api/_spike/hash?iter=100000'), bindings)
    expect(res.status).toBe(404)
  })

  it('/api/dev/* đóng khi không có DEV_LINKS_API=1', async () => {
    const res = await call('GET', '/dev/links', null)
    expect([403, 404]).toContain(res.status)
  })

  it('cookie giả lập az_mock_session KHÔNG có tác dụng khi không bật cờ dev', async () => {
    for (const who of ['admin@az.local', 'user@az.local']) {
      const res = await call('GET', '/links', `az_mock_session=${who}`)
      expect(res.status).toBe(401)
    }
  })

  it('cờ dev chỉ nhận đúng "1": "true"/"yes" không mở cookie giả lập', async () => {
    for (const flag of ['true', 'yes', ' 1', '01']) {
      const res = await app.fetch(
        new Request('http://az.test/api/links', {
          headers: { Cookie: 'az_mock_session=admin@az.local' },
        }),
        { ...bindings, DEV_LINKS_API: flag },
      )
      expect(res.status).toBe(401)
    }
  })
})

describe('đăng nhập: ca hiếm', () => {
  // Lỗi 4: kiểm tra `locked_until` chạy TRƯỚC khi so mật khẩu và chỉ tài khoản có thật mới bị khóa, nên kẻ lạ
  // thử 5 mật khẩu sai là biết email nào tồn tại (lần 6 ra 429, email không có thì mãi 401). Cũng có thể khóa
  // admin 15 phút liên tục (kể cả khi admin gõ đúng mật khẩu).
  it.fails('email có thật và email không tồn tại cho cùng chuỗi mã trạng thái (không lộ tài khoản)', async () => {
    await seedUser('victim@az.test')
    const attempt = async (email: string) => {
      const codes: number[] = []
      for (let i = 0; i < 7; i++) {
        codes.push((await call('POST', '/auth/login', null, { email, password: 'sai-sai-sai-1' })).status)
      }
      return codes
    }
    expect(await attempt('victim@az.test')).toEqual(await attempt('khong-co-ai@az.test'))
  })

  it('sai 5 lần thì khóa tạm: 429 kèm Retry-After; mật khẩu đúng cũng bị từ chối trong lúc khóa', async () => {
    await seedUser('lock@az.test')
    for (let i = 0; i < 5; i++) {
      expect((await call('POST', '/auth/login', null, { email: 'lock@az.test', password: 'sai-sai-sai-1' })).status).toBe(401)
    }
    const res = await call('POST', '/auth/login', null, { email: 'lock@az.test', password: TEST_PASSWORD })
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(res.headers.get('Set-Cookie')).toBeNull()
  })

  it('mật khẩu đúng 128 ký tự đăng nhập được, 129 ký tự bị 400, 200.000 ký tự cũng chỉ 400 (không treo)', async () => {
    const long = `${'a'.repeat(120)}-Mat-123`
    expect(long).toHaveLength(128)
    const { createUser } = await import('../../src/services/user-service')
    await createUser(
      env.DB,
      { email: 'long@az.test', displayName: 'Long', password: long, role: 'user', status: 'active' },
      1_700_000_000,
    )
    expect((await call('POST', '/auth/login', null, { email: 'long@az.test', password: long })).status).toBe(200)
    expect((await call('POST', '/auth/login', null, { email: 'long@az.test', password: `${long}x` })).status).toBe(400)
    expect((await call('POST', '/auth/login', null, { email: 'long@az.test', password: 'x'.repeat(200_000) })).status).toBe(400)
  })

  it('email viết HOA vẫn đăng nhập được (chuẩn hóa chữ thường)', async () => {
    await seedUser('mixed@az.test')
    expect((await call('POST', '/auth/login', null, { email: 'MiXeD@AZ.test', password: TEST_PASSWORD })).status).toBe(200)
  })

  it.each([
    ['không phải JSON', 'not-json'],
    ['mảng', '[]'],
    ['null', 'null'],
    ['thiếu password', '{"email":"a@az.test"}'],
    ['password là số', '{"email":"a@az.test","password":123456}'],
    ['email là object', '{"email":{"$ne":null},"password":"x"}'],
  ])('thân đăng nhập %s -> 400, không ném 500', async (_n, raw) => {
    const res = await app.fetch(
      new Request('http://az.test/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: raw,
      }),
      bindings,
    )
    expect(res.status).toBe(400)
  })

  it('Content-Type text/plain bị từ chối (chống form chéo trang)', async () => {
    await seedUser('ct@az.test')
    const res = await app.fetch(
      new Request('http://az.test/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ email: 'ct@az.test', password: TEST_PASSWORD }),
      }),
      bindings,
    )
    expect(res.status).toBe(400)
    expect(res.headers.get('Set-Cookie')).toBeNull()
  })
})

describe('cookie phiên và token: giá trị bất thường', () => {
  it.each([
    ['percent-encoding hỏng', 'az_session=%E0%A4%A'],
    ['chỉ dấu %', 'az_session=%'],
    ['rỗng', 'az_session='],
    ['rất dài (10 KB)', `az_session=${'a'.repeat(10_000)}`],
    ['ký tự điều khiển', 'az_session=abc%00def%0d%0a'],
    ['tên cookie gần giống', 'az_session2=abc; Az_Session=abc'],
  ])('cookie %s -> 401, không 500', async (_n, cookie) => {
    expect((await call('GET', '/me', cookie)).status).toBe(401)
    expect((await call('GET', '/links', cookie)).status).toBe(401)
  })

  it('độ dài mã phiên ngoài [20,128] bị loại trước khi chạm DB', async () => {
    expect(await findSession(env.DB, 'a'.repeat(19), 1)).toBeNull()
    expect(await findSession(env.DB, 'a'.repeat(129), 1)).toBeNull()
  })

  it('người dùng bị khóa giữa chừng: phiên cũ mất hiệu lực ngay ở REST', async () => {
    const u = await seedUser('susp@az.test')
    const cookie = await loginAs('susp@az.test')
    expect((await call('GET', '/me', cookie)).status).toBe(200)
    await env.DB.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").bind(u.id).run()
    expect((await call('GET', '/me', cookie)).status).toBe(401)
    expect((await call('GET', '/links', cookie)).status).toBe(401)
  })

  it('đăng xuất xóa phiên thật sự: dùng lại cookie cũ -> 401', async () => {
    await seedUser('out@az.test')
    const cookie = await loginAs('out@az.test')
    expect((await call('POST', '/auth/logout', cookie, {})).status).toBe(200)
    expect((await call('GET', '/me', cookie)).status).toBe(401)
  })

  // Lỗi 5 (nhỏ): RFC 7235 coi tên scheme không phân biệt hoa thường, nhưng code dùng startsWith('Bearer ').
  // Proxy/thư viện HTTP hạ thấp chữ sẽ bị 401 oan (cũng áp dụng cho SYNC_TOKEN trong lib/service-auth.ts).
  it.fails('Authorization: "bearer <token>" (chữ thường) vẫn được chấp nhận ở /api/gw/check', async () => {
    const { token } = await seedToken(7)
    const res = await app.fetch(
      new Request('http://az.test/api/gw/check', { headers: { Authorization: `bearer ${token}` } }),
      bindings,
    )
    expect(res.status).toBe(200)
  })

  it('token Gateway dạng lạ bị 401, không tới DB: rỗng, khoảng trắng, quá dài, có ký tự lạ', async () => {
    for (const given of ['', ' ', 'azt_', `azt_${'a'.repeat(5_000)}`, 'azt_<script>', 'Basic abc']) {
      const res = await app.fetch(
        new Request('http://az.test/api/gw/check', {
          headers: { Authorization: given.startsWith('Basic') ? given : `Bearer ${given}` },
        }),
        bindings,
      )
      expect(res.status).toBe(401)
    }
  })
})

describe('Origin của WebSocket (isOriginAllowed)', () => {
  const base = { requestHost: 'az.test', allowedCsv: undefined, dev: false }

  it('không có Origin (client không phải trình duyệt) được qua; Origin cùng host được qua', () => {
    expect(isOriginAllowed({ ...base, origin: undefined })).toBe(true)
    expect(isOriginAllowed({ ...base, origin: '' })).toBe(true)
    expect(isOriginAllowed({ ...base, origin: 'https://az.test' })).toBe(true)
  })

  it.each([
    ['chuỗi "null" (iframe sandbox, file://)', 'null'],
    ['host lạ', 'https://evil.example'],
    ['hậu tố đánh lừa', 'https://evilaz.test'],
    ['tiền tố đánh lừa', 'https://az.test.evil.example'],
    ['userinfo đánh lừa', 'https://az.test@evil.example'],
    ['cùng host khác cổng', 'https://az.test:8443'],
    ['không phải URL', 'az.test'],
    ['scheme lạ', 'chrome-extension://abcdef'],
  ])('từ chối Origin %s', (_n, origin) => {
    expect(isOriginAllowed({ ...base, origin })).toBe(false)
  })

  it('danh sách cho phép: bỏ khoảng trắng, dấu / cuối, không phân biệt hoa thường; mục rỗng bị bỏ qua', () => {
    const allowedCsv = ' https://Ui.Example.com/ , ,https://other.example '
    expect(isOriginAllowed({ ...base, allowedCsv, origin: 'https://ui.example.com' })).toBe(true)
    expect(isOriginAllowed({ ...base, allowedCsv, origin: 'https://OTHER.example' })).toBe(true)
    expect(isOriginAllowed({ ...base, allowedCsv, origin: 'https://ui.example.com.evil.io' })).toBe(false)
  })

  it('origin của Vite chỉ được thêm khi bật cờ dev', () => {
    const vite = 'http://localhost:5173'
    expect(isOriginAllowed({ ...base, origin: vite })).toBe(false)
    expect(isOriginAllowed({ ...base, origin: vite, dev: true })).toBe(true)
  })
})

describe('quyền thao tác trên liên kết', () => {
  let root = ''
  let user = ''
  let linkId = 0
  let linkKey = ''

  beforeEach(async () => {
    await seedUser('root@az.test', { role: 'root_admin' })
    const owner = await seedUser('a@az.test')
    const link = await seedLink()
    linkId = link.id
    linkKey = link.key
    await setOwner(linkId, owner.id)
    root = await loginAs('root@az.test')
    user = await loginAs('a@az.test')
  })

  // Lỗi 6 (cần xác nhận ý đồ): route /status dùng chung `authorize` cho chủ liên kết lẫn admin, nên người dùng
  // thường tự bật lại liên kết mà admin đã tắt (vd. để chặn lạm dụng hoặc dừng giao dịch từ xa).
  it.fails('người dùng thường KHÔNG tự bật lại được liên kết do admin đã tắt', async () => {
    expect((await call('POST', `/links/${linkId}/status`, root, { status: 'disabled' })).status).toBe(200)
    const res = await call('POST', `/links/${linkId}/status`, user, { status: 'active' })
    expect(res.status).toBe(403)
  })

  it('người dùng khác (không phải chủ) nhận 404 y hệt liên kết không tồn tại', async () => {
    await seedUser('b@az.test')
    const other = await loginAs('b@az.test')
    const real = await call('GET', `/links/${linkId}`, other)
    const fake = await call('GET', '/links/999999', other)
    expect(real.status).toBe(404)
    expect(await real.json()).toEqual(await fake.json())
  })

  it.each(['abc', '-1', '0', '1.5', '1e3', '99999999999999999999', '%00', ' 1'])(
    'id liên kết bất thường %j -> 4xx, không 500',
    async (id) => {
      for (const [method, suffix] of [['GET', ''], ['POST', '/status'], ['POST', '/rotate-key'], ['DELETE', '']] as const) {
        const res = await call(method, `/links/${encodeURIComponent(id)}${suffix}`, root, method === 'POST' ? {} : undefined)
        expect(res.status).toBeGreaterThanOrEqual(400)
        expect(res.status).toBeLessThan(500)
      }
    },
  )

  it('cấp lại khóa: khóa cũ không còn dùng được ở ingest ngay lập tức', async () => {
    const { post, makePayload } = await import('../helpers')
    const ok = await post(linkKey, makePayload())
    expect(ok.status).toBe(200)
    const rotated = await call('POST', `/links/${linkId}/rotate-key`, root, {})
    expect(rotated.status).toBe(200)
    const after = await post(linkKey, makePayload())
    expect(after.status).toBe(401)
  })

  // Hardening (7): SameSite=Lax là lớp duy nhất chống CSRF cho các route ghi (kể cả giao dịch từ xa). Nên có
  // lớp thứ hai: từ chối request ghi có Origin khác host (hoặc Sec-Fetch-Site=cross-site).
  it.fails('request GHI mang Origin của trang lạ bị từ chối dù cookie hợp lệ', async () => {
    const res = await call('POST', `/links/${linkId}/trade-enabled`, root, { enabled: true }, { Origin: 'https://evil.example' })
    expect(res.status).toBe(403)
  })

  it('request ghi cùng Origin với host vẫn chạy bình thường', async () => {
    const res = await call('POST', `/links/${linkId}/trade-enabled`, root, { enabled: true }, { Origin: 'http://az.test' })
    expect(res.status).toBe(200)
  })
})

describe('giao dịch từ xa: thao tác bấm đúp / hai admin cùng lúc', () => {
  let root = ''
  let linkId = 0
  let key = ''
  let ownerId = 0

  /** Gateway giả nối vào đúng hub mà route dùng, terminal đã bind và online. */
  async function onlineGateway() {
    const hub = env.LIVE_HUB.getByName(HUB_NAME)
    const res = await hub.fetch(
      new Request('http://hub/', {
        headers: { Upgrade: 'websocket', [GW_HEADER]: '1', [GW_TOKEN_HEADER]: encodeGwToken(1, ownerId) },
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
    ws.send(JSON.stringify({ t: 'state', tid: TID, online: true, snap: { bal: 1, eq: 1, fl: 0, ml: null } }))
    await tick()
    return { ws, msgs }
  }

  beforeEach(async () => {
    await seedUser('root@az.test', { role: 'root_admin' })
    const owner = await seedUser('a@az.test')
    const link = await seedLink()
    linkId = link.id
    key = link.key
    ownerId = owner.id
    await setOwner(linkId, owner.id)
    root = await loginAs('root@az.test')
    await call('POST', `/links/${linkId}/trade-enabled`, root, { enabled: true })
  })

  const market = { op: 'market', symbol: 'XAUUSD', side: 'buy', volume: 1, sl: 0, tp: 0 }
  const trade = (body: unknown = market) => call('POST', `/links/${linkId}/trade`, root, body)

  it('lệnh thứ hai gửi TUẦN TỰ khi lệnh đầu còn chờ: 409 TRADE_BUSY, chỉ một lệnh tới Gateway', async () => {
    const gw = await onlineGateway()
    expect((await trade()).status).toBe(202)
    const second = await trade()
    expect(second.status).toBe(409)
    expect(await second.json()).toMatchObject({ error: { code: 'TRADE_BUSY' } })
    await tick()
    expect(gw.msgs.filter((m) => m.t === 'trade')).toHaveLength(1)
  })

  // Lỗi 7 (NGHIÊM TRỌNG): route đọc "có lệnh đang chờ không" rồi mới INSERT (check-then-act, hai lệnh await D1 riêng).
  // Hai request đồng thời (bấm đúp, hai admin, client tự thử lại) cùng qua bước kiểm tra -> hai dòng trade_log và
  // HAI lệnh `trade` xuống Gateway: mở trùng lệnh Market thật.
  it.fails('hai lệnh MARKET gửi ĐỒNG THỜI: đúng một lệnh được gửi, lệnh kia 409 TRADE_BUSY', async () => {
    const gw = await onlineGateway()
    const [a, b] = await Promise.all([trade(), trade()])
    await tick(100)
    expect([a.status, b.status].sort()).toEqual([202, 409])
    const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM trade_log').first<{ n: number }>()
    expect(rows?.n).toBe(1)
    expect(gw.msgs.filter((m) => m.t === 'trade')).toHaveLength(1)
  })

  it.fails('năm lệnh CLOSE_ALL đồng thời: vẫn chỉ một lệnh được gửi', async () => {
    const gw = await onlineGateway()
    const res = await Promise.all(Array.from({ length: 5 }, () => trade({ op: 'close_all', filter: 'all' })))
    await tick(100)
    expect(res.filter((r) => r.status === 202)).toHaveLength(1)
    expect(gw.msgs.filter((m) => m.t === 'trade')).toHaveLength(1)
  })

  it('terminal offline: 409, nhật ký ghi "failed/terminal_offline", lệnh sau không bị kẹt "bận"', async () => {
    const first = await trade()
    expect(first.status).toBe(409)
    const row = await env.DB.prepare('SELECT status, reason FROM trade_log').first<{ status: string; reason: string }>()
    expect(row).toMatchObject({ status: 'failed', reason: 'terminal_offline' })
    const gw = await onlineGateway()
    expect((await trade()).status).toBe(202)
    await tick()
    expect(gw.msgs.filter((m) => m.t === 'trade')).toHaveLength(1)
  })

  it('gỡ gắn tài khoản trong lúc lệnh đang chờ: giao dịch tắt, lệnh mới bị từ chối', async () => {
    await onlineGateway()
    expect((await trade()).status).toBe(202)
    await call('POST', `/links/${linkId}/unbind`, root, {})
    const res = await trade()
    expect([403, 409]).toContain(res.status)
  })
})
