import { DatabaseSync } from 'node:sqlite'
import { DEVICE_AUTO_IP_LIMIT, IP_RULE_DEFAULT_MAX_CONNS } from '@az-sentinel/shared'
import { describe, expect, it } from 'vitest'
import type { DeviceInfo } from '../src/device-id'
import { IpGuard } from '../src/ip-guard'

const T0 = 1_800_000_000_000
const dev = (id: string, kind: 'web' | 'gateway' = 'web'): DeviceInfo => ({ id, kind, ua: 'UA' })
const D1 = dev('a'.repeat(32))
const D2 = dev('b'.repeat(32))

type Opts = { ip?: boolean; device?: boolean; deviceTables?: boolean; ipDeviceColumn?: boolean }

function setup(o: Opts = {}) {
  const { ip = false, device = false, deviceTables = true, ipDeviceColumn = true } = o
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE server_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at INTEGER);
    CREATE TABLE ip_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT NOT NULL UNIQUE, label TEXT NOT NULL DEFAULT '',
      max_conns INTEGER NOT NULL DEFAULT 5, created_by INTEGER, created_at INTEGER NOT NULL
      ${ipDeviceColumn ? ', device_id TEXT' : ''}
    );
    CREATE TABLE ip_blocked (ip TEXT PRIMARY KEY, last_at INTEGER NOT NULL, count INTEGER NOT NULL DEFAULT 1, device_id TEXT) WITHOUT ROWID;
  `)
  if (deviceTables) {
    db.exec(`
      CREATE TABLE device_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL DEFAULT 'web',
        label TEXT NOT NULL DEFAULT '', mode TEXT NOT NULL DEFAULT 'device_only', last_ip TEXT, last_seen INTEGER,
        created_by INTEGER, created_at INTEGER NOT NULL
      );
      CREATE TABLE device_pending (
        device_id TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'web', ip TEXT NOT NULL DEFAULT '',
        user_agent TEXT NOT NULL DEFAULT '', last_at INTEGER NOT NULL, count INTEGER NOT NULL DEFAULT 1
      ) WITHOUT ROWID;
    `)
  }
  if (ip) db.exec("INSERT INTO server_meta (k, v) VALUES ('ip_guard', '1')")
  if (device) db.exec("INSERT INTO server_meta (k, v) VALUES ('device_guard', '1')")
  const clock = { t: T0 }
  const errors: string[] = []
  const guard = new IpGuard(
    db,
    () => clock.t,
    (m) => errors.push(m),
  )
  const addDevice = (id: string, mode: 'any_ip' | 'device_only', label = '') =>
    db
      .prepare('INSERT INTO device_rules (device_id, mode, label, created_at) VALUES (?, ?, ?, 0)')
      .run(id, mode, label)
  const addIp = (pattern: string, maxConns = 5) =>
    db
      .prepare('INSERT INTO ip_rules (ip, max_conns, created_at) VALUES (?, ?, 0)')
      .run(pattern, maxConns)
  const rows = <T = Record<string, unknown>>(sql: string) => db.prepare(sql).all() as T[]
  return { db, guard, clock, errors, addDevice, addIp, rows }
}

describe('IpGuard + thiết bị: chặn', () => {
  it('bật bảo vệ thiết bị: request không mang mã thiết bị bị chặn dù IP hợp lệ', () => {
    const { guard, addIp } = setup({ device: true })
    addIp('9.9.9.9')
    expect(guard.decide('9.9.9.9', '/api/me', null)).toEqual({ allow: false, reason: 'device' })
  })

  it('bật bảo vệ thiết bị: thiết bị lạ bị chặn với lý do device', () => {
    const { guard } = setup({ device: true })
    expect(guard.decide('9.9.9.9', '/api/me', D1)).toEqual({ allow: false, reason: 'device' })
  })

  it('tắt bảo vệ thiết bị: thiết bị lạ hay không có mã đều không bị xét', () => {
    const { guard } = setup()
    expect(guard.decide('9.9.9.9', '/api/me', null).allow).toBe(true)
    expect(guard.decide('9.9.9.9', '/api/me', D1).allow).toBe(true)
  })

  it('máy chạy Server (127.x, ::1, ip rỗng) và hai đường miễn trừ vào được dù thiết bị lạ', () => {
    const { guard } = setup({ device: true, ip: true })
    for (const ip of ['127.0.0.1', '127.8.8.8', '::1', '']) {
      expect(guard.decide(ip, '/api/me', null).allow).toBe(true)
    }
    expect(guard.decide('9.9.9.9', '/api/health', null).allow).toBe(true)
    expect(guard.decide('9.9.9.9', '/api/server-info/self', D1).allow).toBe(true)
    expect(guard.decide('9.9.9.9', '/api/server-info', D1).allow).toBe(false)
  })

  it('gỡ thiết bị khỏi danh sách thì bị chặn lại sau khi hết thời gian đệm 5 giây', () => {
    const { guard, db, clock, addDevice } = setup({ device: true })
    addDevice(D1.id, 'device_only')
    expect(guard.decide('9.9.9.9', '/api/me', D1).allow).toBe(true)
    db.prepare('DELETE FROM device_rules').run()
    clock.t += 1_000
    expect(guard.decide('9.9.9.9', '/api/me', D1).allow).toBe(true) // còn trong đệm
    clock.t += 5_000
    expect(guard.decide('9.9.9.9', '/api/me', D1).allow).toBe(false)
  })

  it('DB cũ chưa migrate 0007 (không có bảng thiết bị): coi như tắt, không văng lỗi', () => {
    const { guard, errors } = setup({ device: true, deviceTables: false })
    expect(guard.decide('9.9.9.9', '/api/me', D1).allow).toBe(true)
    expect(errors).toEqual([])
  })
})

describe('IpGuard + thiết bị: chế độ device_only', () => {
  it('whitelist IP tắt: thiết bị đã duyệt vào được, không bị giới hạn kết nối', () => {
    const { guard, addDevice } = setup({ device: true })
    addDevice(D1.id, 'device_only')
    expect(guard.decide('9.9.9.9', '/api/me', D1)).toEqual({ allow: true, maxConns: null })
  })

  it('whitelist IP bật: thiết bị đã duyệt nhưng IP lạ vẫn bị chặn với lý do ip', () => {
    const { guard, addDevice, rows } = setup({ device: true, ip: true })
    addDevice(D1.id, 'device_only')
    expect(guard.decide('9.9.9.9', '/api/me', D1)).toEqual({ allow: false, reason: 'ip' })
    expect(rows('SELECT * FROM ip_rules')).toHaveLength(0) // không tự thêm IP
  })

  it('whitelist IP bật: IP có trong danh sách thì vào, dùng giới hạn kết nối của luật', () => {
    const { guard, addDevice, addIp } = setup({ device: true, ip: true })
    addDevice(D1.id, 'device_only')
    addIp('9.9.9.9', 7)
    expect(guard.decide('9.9.9.9', '/api/me', D1)).toEqual({ allow: true, maxConns: 7 })
  })

  it('thiết bị này được duyệt không làm thiết bị khác được vào', () => {
    const { guard, addDevice } = setup({ device: true })
    addDevice(D1.id, 'device_only')
    expect(guard.decide('9.9.9.9', '/api/me', D2).allow).toBe(false)
  })
})

describe('IpGuard + thiết bị: chế độ any_ip', () => {
  it('IP mới được tự thêm vào whitelist (gắn mã thiết bị, nhãn, giới hạn mặc định) và vào luôn', () => {
    const { guard, addDevice, rows } = setup({ device: true, ip: true })
    addDevice(D1.id, 'any_ip', 'Laptop Tuan')
    expect(guard.decide('9.9.9.9', '/api/me', D1)).toEqual({
      allow: true,
      maxConns: IP_RULE_DEFAULT_MAX_CONNS,
    })
    expect(rows('SELECT ip, label, device_id, max_conns FROM ip_rules')).toEqual([
      {
        ip: '9.9.9.9',
        label: 'Thiết bị: Laptop Tuan',
        device_id: D1.id,
        max_conns: IP_RULE_DEFAULT_MAX_CONNS,
      },
    ])
  })

  it('thiết bị không có nhãn thì nhãn IP dùng mã ngắn 8 ký tự', () => {
    const { guard, addDevice, rows } = setup({ device: true, ip: true })
    addDevice(D1.id, 'any_ip', '')
    guard.decide('9.9.9.9', '/api/me', D1)
    expect(rows<{ label: string }>('SELECT label FROM ip_rules')[0]?.label).toBe(
      'Thiết bị: aaaaaaaa',
    )
  })

  it('nhãn rất dài bị cắt còn 64 ký tự', () => {
    const { guard, addDevice, rows } = setup({ device: true, ip: true })
    addDevice(D1.id, 'any_ip', 'x'.repeat(200))
    guard.decide('9.9.9.9', '/api/me', D1)
    expect(rows<{ label: string }>('SELECT label FROM ip_rules')[0]?.label).toHaveLength(64)
  })

  it('IP đã khớp luật có sẵn (dải /24) thì dùng luật đó, không thêm dòng mới', () => {
    const { guard, addDevice, addIp, rows } = setup({ device: true, ip: true })
    addDevice(D1.id, 'any_ip')
    addIp('10.0.0.0/24', 50)
    expect(guard.decide('10.0.0.77', '/api/me', D1)).toEqual({ allow: true, maxConns: 50 })
    expect(rows('SELECT * FROM ip_rules')).toHaveLength(1)
  })

  it('IP từng nằm ở "IP bị chặn gần đây" thì được xóa khỏi danh sách đó khi thiết bị vào', () => {
    const { guard, addDevice, db, rows } = setup({ device: true, ip: true })
    addDevice(D1.id, 'any_ip')
    db.prepare("INSERT INTO ip_blocked (ip, last_at, count) VALUES ('9.9.9.9', 1, 3)").run()
    db.prepare("INSERT INTO ip_blocked (ip, last_at, count) VALUES ('8.8.8.8', 1, 1)").run()
    guard.decide('9.9.9.9', '/api/me', D1)
    expect(rows<{ ip: string }>('SELECT ip FROM ip_blocked').map((r) => r.ip)).toEqual(['8.8.8.8'])
  })

  it('IPv6 cũng được tự thêm', () => {
    const { guard, addDevice, rows } = setup({ device: true, ip: true })
    addDevice(D1.id, 'any_ip')
    expect(guard.decide('2001:db8::1', '/api/me', D1).allow).toBe(true)
    expect(rows('SELECT ip FROM ip_rules')).toHaveLength(1)
  })

  it(`mỗi thiết bị giữ tối đa ${DEVICE_AUTO_IP_LIMIT} IP tự thêm, bỏ IP cũ nhất; IP của thiết bị khác không bị đụng`, () => {
    const { guard, addDevice, clock, rows } = setup({ device: true, ip: true })
    addDevice(D1.id, 'any_ip')
    addDevice(D2.id, 'any_ip')
    guard.decide('7.7.7.7', '/api/me', D2)
    for (let i = 1; i <= DEVICE_AUTO_IP_LIMIT + 5; i++) {
      clock.t += 6_000 // vượt thời gian đệm để danh sách luôn được đọc lại
      expect(guard.decide(`20.0.0.${i}`, '/api/me', D1).allow).toBe(true)
    }
    const ofD1 = rows<{ ip: string }>(`SELECT ip FROM ip_rules WHERE device_id = '${D1.id}'`)
    expect(ofD1).toHaveLength(DEVICE_AUTO_IP_LIMIT)
    const ips = ofD1.map((r) => r.ip)
    expect(ips).not.toContain('20.0.0.1') // cũ nhất đã bị bỏ
    expect(ips).toContain(`20.0.0.${DEVICE_AUTO_IP_LIMIT + 5}`)
    expect(rows(`SELECT ip FROM ip_rules WHERE device_id = '${D2.id}'`)).toHaveLength(1)
  })

  it('không ghi được vào DB: báo lỗi, rơi về kiểm tra IP thường (IP lạ bị chặn), không văng ngoại lệ', () => {
    const { guard, addDevice, errors } = setup({ device: true, ip: true, ipDeviceColumn: false })
    addDevice(D1.id, 'any_ip')
    expect(guard.decide('9.9.9.9', '/api/me', D1)).toEqual({ allow: false, reason: 'ip' })
    expect(errors.join(' ')).toContain('không tự thêm được IP')
  })

  it('whitelist IP tắt: vẫn tự thêm IP để khi bật whitelist sau này thiết bị không bị rớt', () => {
    const { guard, addDevice, rows } = setup({ device: true })
    addDevice(D1.id, 'any_ip')
    expect(guard.decide('9.9.9.9', '/api/me', D1).allow).toBe(true)
    expect(rows('SELECT ip FROM ip_rules')).toHaveLength(1)
  })
})

describe('IpGuard + thiết bị: ghi nhận request bị chặn', () => {
  it('thiết bị lạ vào danh sách chờ duyệt kèm IP và user-agent; IP bị chặn gắn mã thiết bị', () => {
    const { guard, rows } = setup({ device: true })
    guard.noteBlocked('9.9.9.9', D1)
    expect(rows('SELECT device_id, kind, ip, user_agent, count FROM device_pending')).toEqual([
      { device_id: D1.id, kind: 'web', ip: '9.9.9.9', user_agent: 'UA', count: 1 },
    ])
    expect(rows('SELECT ip, device_id FROM ip_blocked')).toEqual([
      { ip: '9.9.9.9', device_id: D1.id },
    ])
  })

  it('không mã thiết bị: chỉ ghi IP bị chặn, không có dòng chờ duyệt', () => {
    const { guard, rows } = setup({ device: true })
    guard.noteBlocked('9.9.9.9', null)
    expect(rows('SELECT * FROM device_pending')).toHaveLength(0)
    expect(rows('SELECT ip FROM ip_blocked')).toHaveLength(1)
  })

  it('thiết bị đã duyệt bị chặn vì IP thì không vào danh sách chờ duyệt', () => {
    const { guard, addDevice, rows } = setup({ device: true, ip: true })
    addDevice(D1.id, 'device_only')
    guard.decide('9.9.9.9', '/api/me', D1) // nạp danh sách thiết bị
    guard.noteBlocked('9.9.9.9', D1)
    expect(rows('SELECT * FROM device_pending')).toHaveLength(0)
    expect(rows('SELECT device_id FROM ip_blocked')).toEqual([{ device_id: D1.id }])
  })

  it('cùng IP + thiết bị: ghi tối đa 30 giây một lần; sau đó đếm tăng dần', () => {
    const { guard, clock, rows } = setup({ device: true })
    guard.noteBlocked('9.9.9.9', D1)
    clock.t += 10_000
    guard.noteBlocked('9.9.9.9', D1)
    expect(rows<{ count: number }>('SELECT count FROM device_pending')[0]?.count).toBe(1)
    clock.t += 21_000
    guard.noteBlocked('9.9.9.9', D1)
    expect(rows<{ count: number }>('SELECT count FROM device_pending')[0]?.count).toBe(2)
    expect(rows<{ count: number }>('SELECT count FROM ip_blocked')[0]?.count).toBe(2)
  })

  it('cùng thiết bị đổi IP: vẫn một dòng chờ duyệt, cập nhật IP mới nhất', () => {
    const { guard, rows } = setup({ device: true })
    guard.noteBlocked('1.1.1.1', D1)
    guard.noteBlocked('2.2.2.2', D1)
    expect(rows('SELECT ip, count FROM device_pending')).toEqual([{ ip: '2.2.2.2', count: 2 }])
  })

  it('danh sách chờ duyệt giữ tối đa 200 dòng, IP bị chặn giữ tối đa 50 dòng', () => {
    const { guard, clock, rows } = setup({ device: true })
    for (let i = 0; i < 210; i++) {
      clock.t += 1_000
      const id = i.toString(16).padStart(32, '0')
      guard.noteBlocked(`30.0.${Math.floor(i / 250)}.${i % 250}`, dev(id))
    }
    expect(rows('SELECT * FROM device_pending')).toHaveLength(200)
    expect(rows('SELECT * FROM ip_blocked')).toHaveLength(50)
  })

  it('thiếu bảng chờ duyệt (DB cũ): báo lỗi qua onError chứ không làm sập request', () => {
    const { guard, errors } = setup({ deviceTables: false })
    expect(() => guard.noteBlocked('9.9.9.9', D1)).not.toThrow()
    expect(errors.join(' ')).toContain('không ghi được thiết bị chờ duyệt')
  })
})

describe('IpGuard: lần thấy cuối, kết nối, thông báo', () => {
  it('cập nhật last_ip/last_seen của thiết bị đã duyệt tối đa mỗi phút một lần', () => {
    const { guard, clock, addDevice, rows } = setup({ device: true })
    addDevice(D1.id, 'device_only')
    guard.decide('1.1.1.1', '/api/me', D1)
    clock.t += 30_000
    guard.decide('2.2.2.2', '/api/me', D1)
    expect(rows<{ last_ip: string }>('SELECT last_ip FROM device_rules')[0]?.last_ip).toBe(
      '1.1.1.1',
    )
    clock.t += 31_000
    guard.decide('2.2.2.2', '/api/me', D1)
    expect(rows<{ last_ip: string }>('SELECT last_ip FROM device_rules')[0]?.last_ip).toBe(
      '2.2.2.2',
    )
  })

  it('acquire: đủ giới hạn thì từ chối; release gọi hai lần chỉ trả một chỗ', () => {
    const { guard } = setup()
    const a = guard.acquire('1.1.1.1', 2)
    const b = guard.acquire('1.1.1.1', 2)
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(guard.acquire('1.1.1.1', 2)).toBeNull()
    a?.()
    a?.() // gọi lại không được trả thêm chỗ
    expect(guard.acquire('1.1.1.1', 2)).not.toBeNull()
    expect(guard.acquire('1.1.1.1', 2)).toBeNull()
    expect(guard.acquire('2.2.2.2', 2)).not.toBeNull() // IP khác không bị ảnh hưởng
  })

  it('describeBlock: có mã ngắn + IP khi biết thiết bị; nhắc cập nhật Gateway khi không nhận diện được', () => {
    const { guard } = setup()
    const known = guard.describeBlock('9.9.9.9', 'device', D1)
    expect(known).toContain('aaaaaaaa')
    expect(known).toContain('9.9.9.9')
    expect(known).not.toContain(D1.id) // không lộ mã đầy đủ
    const unknown = guard.describeBlock('9.9.9.9', 'device', null)
    expect(unknown).toContain('Không nhận diện được thiết bị')
    expect(unknown).toContain('9.9.9.9')
    expect(guard.describeBlock('9.9.9.9', 'ip', D1)).toContain('whitelist')
  })
})
