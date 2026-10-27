import { DatabaseSync } from 'node:sqlite'
import { DEVICE_ADOPT_LIMIT, DEVICE_ADOPT_WINDOW_SEC } from '@az-sentinel/shared'
import { describe, expect, it } from 'vitest'
import type { DeviceInfo } from '../src/device-id'
import { IpGuard } from '../src/ip-guard'

const T0 = 1_800_000_000_000
const SEC0 = T0 / 1000
const dev = (c: string, kind: 'web' | 'gateway' = 'web'): DeviceInfo => ({
  id: c.repeat(32),
  kind,
  ua: 'UA',
})
const BROWSER = dev('a') // trình duyệt đã duyệt
const APP = dev('b') // app cài (cookie riêng) = thiết bị lạ
const IP = '203.0.113.7'

function setup(o: { ip?: boolean; adoptOff?: boolean } = {}) {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE server_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at INTEGER);
    CREATE TABLE ip_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT NOT NULL UNIQUE, label TEXT NOT NULL DEFAULT '',
      max_conns INTEGER NOT NULL DEFAULT 5, created_by INTEGER, created_at INTEGER NOT NULL, device_id TEXT);
    CREATE TABLE ip_blocked (ip TEXT PRIMARY KEY, last_at INTEGER NOT NULL, count INTEGER NOT NULL DEFAULT 1, device_id TEXT) WITHOUT ROWID;
    CREATE TABLE device_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL DEFAULT 'web',
      label TEXT NOT NULL DEFAULT '', mode TEXT NOT NULL DEFAULT 'device_only', last_ip TEXT, last_seen INTEGER,
      created_by INTEGER, created_at INTEGER NOT NULL);
    CREATE TABLE device_pending (device_id TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'web', ip TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '', last_at INTEGER NOT NULL, count INTEGER NOT NULL DEFAULT 1) WITHOUT ROWID;
    INSERT INTO server_meta (k, v) VALUES ('device_guard', '1');
  `)
  if (o.ip) db.exec("INSERT INTO server_meta (k, v) VALUES ('ip_guard', '1')")
  if (o.adoptOff) db.exec("INSERT INTO server_meta (k, v) VALUES ('device_adopt', '0')")
  const clock = { t: T0 }
  const errors: string[] = []
  const guard = new IpGuard(
    db,
    () => clock.t,
    (m) => errors.push(m),
  )
  /** Thiết bị do quản trị viên duyệt (created_by = 1), vừa thấy ở `lastIp`. */
  const approve = (
    d: DeviceInfo,
    mode: 'any_ip' | 'device_only',
    label: string,
    lastIp: string | null = IP,
    seenAgoSec = 60,
    kind: 'web' | 'gateway' = 'web',
  ) =>
    db
      .prepare(
        'INSERT INTO device_rules (device_id, kind, label, mode, last_ip, last_seen, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, 0)',
      )
      .run(d.id, kind, label, mode, lastIp, SEC0 - seenAgoSec)
  const addIpRule = (ip: string, deviceId: string | null = null) =>
    db
      .prepare('INSERT INTO ip_rules (ip, created_at, device_id) VALUES (?, 0, ?)')
      .run(ip, deviceId)
  const rules = () =>
    db.prepare('SELECT device_id, label, mode, last_ip, created_by FROM device_rules').all() as {
      device_id: string
      label: string
      mode: string
      last_ip: string
      created_by: number
    }[]
  return { db, guard, clock, errors, approve, addIpRule, rules }
}

describe('duyệt thiết bị "cùng máy"', () => {
  it('app cài (thiết bị lạ) cùng IP với trình duyệt đã duyệt: vào được, được ghi vào danh sách', () => {
    const t = setup()
    t.approve(BROWSER, 'device_only', 'Chrome · Windows')
    expect(t.guard.decide(IP, '/api/me', APP)).toMatchObject({ allow: true })
    const adopted = t.rules().find((r) => r.device_id === APP.id)
    expect(adopted).toMatchObject({
      label: 'Cùng máy: Chrome · Windows',
      mode: 'device_only',
      last_ip: IP,
      created_by: 0,
    })
  })

  it('thừa kế chế độ any_ip của thiết bị gốc', () => {
    const t = setup()
    t.approve(BROWSER, 'any_ip', 'Chrome')
    t.guard.decide(IP, '/api/me', APP)
    expect(t.rules().find((r) => r.device_id === APP.id)?.mode).toBe('any_ip')
  })

  it('xóa thiết bị khỏi danh sách chờ duyệt khi được duyệt theo', () => {
    const t = setup()
    t.approve(BROWSER, 'device_only', 'Chrome')
    t.guard.noteBlocked(IP, APP) // lần đầu bị chặn, nằm ở danh sách chờ
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM device_pending').get()).toEqual({ n: 1 })
    t.guard.decide(IP, '/api/me', APP)
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM device_pending').get()).toEqual({ n: 0 })
  })

  it('IP khác IP của thiết bị đã duyệt: vẫn 403 (thiết bị lạ thật sự)', () => {
    const t = setup()
    t.approve(BROWSER, 'device_only', 'Chrome')
    expect(t.guard.decide('198.51.100.9', '/api/me', APP)).toEqual({
      allow: false,
      reason: 'device',
    })
    expect(t.rules()).toHaveLength(1)
  })

  it('thiết bị gốc đã quá lâu không thấy: không duyệt theo', () => {
    const t = setup()
    t.approve(BROWSER, 'device_only', 'Chrome', IP, DEVICE_ADOPT_WINDOW_SEC + 60)
    expect(t.guard.decide(IP, '/api/me', APP)).toEqual({ allow: false, reason: 'device' })
  })

  it('IP do thiết bị gốc tự thêm vào whitelist thì tính dù lần thấy cuối đã cũ', () => {
    const t = setup()
    t.approve(BROWSER, 'any_ip', 'Chrome', '1.1.1.1', DEVICE_ADOPT_WINDOW_SEC + 60)
    t.addIpRule(IP, BROWSER.id)
    expect(t.guard.decide(IP, '/api/me', APP)).toMatchObject({ allow: true })
  })

  it('IP do quản trị viên nhập tay (không gắn thiết bị) KHÔNG tự duyệt thiết bị lạ', () => {
    const t = setup()
    t.addIpRule(IP, null)
    expect(t.guard.decide(IP, '/api/me', APP)).toEqual({ allow: false, reason: 'device' })
  })

  it('Gateway: không bao giờ được duyệt kiểu này, và Gateway cũng không làm thiết bị gốc', () => {
    const t = setup()
    t.approve(BROWSER, 'device_only', 'Chrome')
    expect(t.guard.decide(IP, '/api/gw/ws', dev('c', 'gateway'))).toEqual({
      allow: false,
      reason: 'device',
    })
    const t2 = setup()
    t2.approve(dev('d', 'gateway'), 'device_only', 'VPS', IP, 60, 'gateway')
    expect(t2.guard.decide(IP, '/api/me', APP)).toEqual({ allow: false, reason: 'device' })
  })

  it('không duyệt dây chuyền: thiết bị đã tự duyệt không làm thiết bị gốc cho thiết bị khác', () => {
    const t = setup()
    t.approve(BROWSER, 'device_only', 'Chrome')
    t.guard.decide(IP, '/api/me', APP) // APP được duyệt theo BROWSER
    t.db.prepare('DELETE FROM device_rules WHERE device_id = ?').run(BROWSER.id) // gỡ gốc
    const other = dev('e')
    expect(t.guard.decide(IP, '/api/me', other)).toEqual({ allow: false, reason: 'device' })
  })

  it(`mỗi IP tối đa ${DEVICE_ADOPT_LIMIT} thiết bị tự duyệt`, () => {
    const t = setup()
    t.approve(BROWSER, 'device_only', 'Chrome')
    const chars = 'fghijklm'
    const results = [...chars].map((c) => t.guard.decide(IP, '/api/me', dev(c)).allow)
    expect(results.filter(Boolean)).toHaveLength(DEVICE_ADOPT_LIMIT)
  })

  it('request không mang mã thiết bị thì vẫn bị chặn như cũ', () => {
    const t = setup()
    t.approve(BROWSER, 'device_only', 'Chrome')
    expect(t.guard.decide(IP, '/api/me', null)).toEqual({ allow: false, reason: 'device' })
  })

  it('có thể tắt bằng server_meta device_adopt = 0', () => {
    const t = setup({ adoptOff: true })
    t.approve(BROWSER, 'device_only', 'Chrome')
    expect(t.guard.decide(IP, '/api/me', APP)).toEqual({ allow: false, reason: 'device' })
  })
})

describe('kết hợp với whitelist IP', () => {
  it('IP đang được bảo vệ mà chưa có trong whitelist: không duyệt thiết bị theo (chưa có bằng chứng đã vào được)', () => {
    const t = setup({ ip: true })
    t.approve(BROWSER, 'device_only', 'Chrome')
    expect(t.guard.decide(IP, '/api/me', APP)).toEqual({ allow: false, reason: 'device' })
  })

  it('IP đã trong whitelist: thiết bị được duyệt theo và vào được', () => {
    const t = setup({ ip: true })
    t.approve(BROWSER, 'device_only', 'Chrome')
    t.addIpRule(IP, null)
    expect(t.guard.decide(IP, '/api/me', APP)).toMatchObject({ allow: true })
  })

  it('chế độ any_ip: app được duyệt theo rồi đổi mạng thì IP mới tự vào whitelist, gắn với app', () => {
    const t = setup({ ip: true })
    t.approve(BROWSER, 'any_ip', 'Chrome')
    t.addIpRule(IP, BROWSER.id) // IP cũ do trình duyệt gốc tự thêm: bằng chứng cho việc duyệt theo
    expect(t.guard.decide(IP, '/api/me', APP)).toMatchObject({ allow: true })
    // app đã là thiết bị any_ip (thừa kế), nên IP mới được trustIp thêm vào whitelist
    expect(t.guard.decide('203.0.113.99', '/api/me', APP)).toMatchObject({ allow: true })
    const added = t.db
      .prepare('SELECT label, device_id FROM ip_rules WHERE ip = ?')
      .get('203.0.113.99') as { label: string; device_id: string } | undefined
    expect(added).toEqual({ label: 'Thiết bị: Cùng máy: Chrome', device_id: APP.id })
  })
})

describe('duyệt "cùng máy": biên và các trường hợp phụ', () => {
  it('chỉ chạy khi bật bảo vệ thiết bị: tắt thì không ghi thiết bị nào vào danh sách', () => {
    const t = setup()
    t.db.exec("UPDATE server_meta SET v = '0' WHERE k = 'device_guard'")
    t.approve(BROWSER, 'device_only', 'Chrome')
    expect(t.guard.decide(IP, '/api/me', APP)).toMatchObject({ allow: true })
    expect(t.rules()).toHaveLength(1)
  })

  it('đúng biên cửa sổ thời gian: đúng 7 ngày thì còn tính, quá 1 giây thì không', () => {
    const edge = setup()
    edge.approve(BROWSER, 'device_only', 'Chrome', IP, DEVICE_ADOPT_WINDOW_SEC)
    expect(edge.guard.decide(IP, '/api/me', APP)).toMatchObject({ allow: true })
    const over = setup()
    over.approve(BROWSER, 'device_only', 'Chrome', IP, DEVICE_ADOPT_WINDOW_SEC + 1)
    expect(over.guard.decide(IP, '/api/me', APP)).toEqual({ allow: false, reason: 'device' })
  })

  it('hạn mức tính riêng từng IP: IP này đầy thì IP khác vẫn duyệt được', () => {
    const t = setup()
    const other = '198.51.100.9'
    t.approve(BROWSER, 'device_only', 'Chrome') // gốc ở IP
    t.approve(dev('z'), 'device_only', 'Edge', other) // gốc khác ở IP thứ hai
    const full = [...'fghijklm'].map((c) => t.guard.decide(IP, '/api/me', dev(c)).allow)
    expect(full.filter(Boolean)).toHaveLength(DEVICE_ADOPT_LIMIT)
    expect(t.guard.decide(other, '/api/me', dev('n'))).toMatchObject({ allow: true })
  })

  it('đã đầy hạn mức: thiết bị đã được duyệt trước đó vẫn vào bình thường', () => {
    const t = setup()
    t.approve(BROWSER, 'device_only', 'Chrome')
    const first = dev('f')
    for (const c of 'fghijklm') t.guard.decide(IP, '/api/me', dev(c))
    expect(t.guard.decide(IP, '/api/me', first)).toMatchObject({ allow: true })
  })

  it('nguồn có created_by rỗng (dữ liệu cũ) vẫn tính là thiết bị do quản trị viên duyệt', () => {
    const t = setup()
    t.approve(BROWSER, 'device_only', 'Chrome')
    t.db.prepare('UPDATE device_rules SET created_by = NULL WHERE device_id = ?').run(BROWSER.id)
    expect(t.guard.decide(IP, '/api/me', APP)).toMatchObject({ allow: true })
  })

  it('nhãn: gốc không có nhãn thì dùng nhãn mặc định, nhãn dài bị cắt còn 64 ký tự', () => {
    const blank = setup()
    blank.approve(BROWSER, 'device_only', '')
    blank.guard.decide(IP, '/api/me', APP)
    expect(blank.rules().find((r) => r.device_id === APP.id)?.label).toBe(
      'Cùng máy: thiết bị đã duyệt',
    )
    const long = setup()
    long.approve(BROWSER, 'device_only', 'x'.repeat(200))
    long.guard.decide(IP, '/api/me', APP)
    expect(long.rules().find((r) => r.device_id === APP.id)?.label).toHaveLength(64)
  })

  it('đã duyệt rồi thì giữ nguyên sau khi gỡ thiết bị gốc hoặc khởi động lại Server', () => {
    const t = setup()
    t.approve(BROWSER, 'device_only', 'Chrome')
    t.guard.decide(IP, '/api/me', APP)
    t.db.prepare('DELETE FROM device_rules WHERE device_id = ?').run(BROWSER.id)
    const restarted = new IpGuard(t.db, () => t.clock.t)
    expect(restarted.decide(IP, '/api/me', APP)).toMatchObject({ allow: true })
  })

  it('bấm Bỏ mà thiết bị gốc còn đủ điều kiện: request kế tiếp từ cùng IP được duyệt lại (hành vi hiện tại)', () => {
    const t = setup()
    t.approve(BROWSER, 'device_only', 'Chrome')
    t.guard.decide(IP, '/api/me', APP)
    t.db.prepare('DELETE FROM device_rules WHERE device_id = ?').run(APP.id) // "Bỏ" trên web
    t.clock.t += 6_000 // qua thời gian làm mới bộ nhớ đệm của IpGuard
    expect(t.guard.decide(IP, '/api/me', APP)).toMatchObject({ allow: true })
    expect(t.rules().filter((r) => r.device_id === APP.id)).toHaveLength(1)
  })

  it('bấm Bỏ rồi tắt device_adopt: thiết bị bị chặn lại', () => {
    const t = setup()
    t.approve(BROWSER, 'device_only', 'Chrome')
    t.guard.decide(IP, '/api/me', APP)
    t.db.prepare('DELETE FROM device_rules WHERE device_id = ?').run(APP.id)
    t.db.exec("INSERT INTO server_meta (k, v) VALUES ('device_adopt', '0')")
    t.clock.t += 6_000
    expect(t.guard.decide(IP, '/api/me', APP)).toEqual({ allow: false, reason: 'device' })
  })
})
