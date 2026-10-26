import {
  type DeviceKind,
  type DeviceMode,
  type DevicePending,
  type DeviceRule,
  parseIpPattern,
} from '@az-sentinel/shared'

const GUARD_KEY = 'device_guard'
const COLUMNS = 'id, device_id, kind, label, mode, last_ip, last_seen, created_at'

export async function listDevices(db: D1Database): Promise<DeviceRule[]> {
  const { results } = await db
    .prepare(`SELECT ${COLUMNS} FROM device_rules ORDER BY id`)
    .all<DeviceRule>()
  return results
}

export async function listPending(db: D1Database): Promise<DevicePending[]> {
  const { results } = await db
    .prepare(
      'SELECT device_id, kind, ip, user_agent, last_at, count FROM device_pending ORDER BY last_at DESC LIMIT 30',
    )
    .all<DevicePending>()
  return results
}

export async function isDeviceEnforced(db: D1Database): Promise<boolean> {
  const row = await db
    .prepare('SELECT v FROM server_meta WHERE k = ?')
    .bind(GUARD_KEY)
    .first<{ v: string }>()
  return row?.v === '1'
}

export async function setDeviceEnforced(db: D1Database, on: boolean, now: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO server_meta (k, v, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at`,
    )
    .bind(GUARD_KEY, on ? '1' : '0', now)
    .run()
}

/** Thiết bị `deviceId` có trong danh sách không. Không biết thiết bị (null: gọi từ máy Server) thì coi là được. */
export function deviceAllowed(rules: DeviceRule[], deviceId: string | null): boolean {
  return deviceId === null || rules.some((r) => r.device_id === deviceId)
}

/**
 * Duyệt một thiết bị. Trả null nếu đã có. Loại thiết bị (web/gateway) và IP vừa bị chặn lấy từ danh sách
 * "thiết bị chờ duyệt"; duyệt xong thì bỏ khỏi danh sách chờ. Chế độ `any_ip` thêm luôn IP vừa bị chặn (nếu có)
 * vào whitelist IP để người dùng vào lại ngay, không phải chờ request kế tiếp.
 */
export async function createDevice(
  db: D1Database,
  input: { device_id: string; label: string; mode: DeviceMode },
  createdBy: number,
  now: number,
): Promise<DeviceRule | null> {
  const exists = await db
    .prepare('SELECT id FROM device_rules WHERE device_id = ?')
    .bind(input.device_id)
    .first()
  if (exists) return null
  const pending = await db
    .prepare('SELECT kind, ip FROM device_pending WHERE device_id = ?')
    .bind(input.device_id)
    .first<{ kind: DeviceKind; ip: string }>()
  const row = await db
    .prepare(
      `INSERT INTO device_rules (device_id, kind, label, mode, last_ip, last_seen, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING ${COLUMNS}`,
    )
    .bind(
      input.device_id,
      pending?.kind ?? 'web',
      input.label,
      input.mode,
      pending?.ip || null,
      pending ? now : null,
      createdBy,
      now,
    )
    .first<DeviceRule>()
  await db.prepare('DELETE FROM device_pending WHERE device_id = ?').bind(input.device_id).run()
  const pattern = pending?.ip ? parseIpPattern(pending.ip) : null
  // Chỉ thêm đúng một địa chỉ (không phải dải) để duyệt thiết bị không vô tình mở cả một dải.
  if (input.mode === 'any_ip' && pattern && (pattern.kind === 'v6' || pattern.bits === 32)) {
    await trustIp(db, input.device_id, pattern.text, input.label, now)
  }
  return row
}

/** Thêm IP vào whitelist IP nếu chưa có luật nào cho IP đó; ghi nhớ thiết bị đã thêm. */
async function trustIp(
  db: D1Database,
  deviceId: string,
  ip: string,
  label: string,
  now: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO ip_rules (ip, label, max_conns, created_by, created_at, device_id)
       VALUES (?, ?, 5, 0, ?, ?)`,
    )
    .bind(ip, `Thiết bị: ${label || deviceId.slice(0, 8)}`.slice(0, 64), now, deviceId)
    .run()
  await db.prepare('DELETE FROM ip_blocked WHERE ip = ?').bind(ip).run()
}

export async function updateDevice(
  db: D1Database,
  id: number,
  patch: { label?: string; mode?: DeviceMode },
): Promise<DeviceRule | null> {
  return db
    .prepare(
      `UPDATE device_rules SET label = COALESCE(?, label), mode = COALESCE(?, mode) WHERE id = ?
       RETURNING ${COLUMNS}`,
    )
    .bind(patch.label ?? null, patch.mode ?? null, id)
    .first<DeviceRule>()
}

export async function getDevice(db: D1Database, id: number): Promise<DeviceRule | null> {
  return db.prepare(`SELECT ${COLUMNS} FROM device_rules WHERE id = ?`).bind(id).first<DeviceRule>()
}

/** Gỡ thiết bị và các IP mà thiết bị đó đã tự thêm vào whitelist IP. */
export async function deleteDevice(db: D1Database, device: DeviceRule): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM ip_rules WHERE device_id = ?').bind(device.device_id),
    db.prepare('DELETE FROM device_rules WHERE id = ?').bind(device.id),
  ])
}

export async function dismissPending(db: D1Database, deviceId: string): Promise<boolean> {
  const res = await db
    .prepare('DELETE FROM device_pending WHERE device_id = ?')
    .bind(deviceId)
    .run()
  return (res.meta?.changes ?? 0) > 0
}
