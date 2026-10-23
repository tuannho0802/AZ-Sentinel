import {
  type IpBlocked,
  type IpRule,
  ipMatches,
  isLoopbackIp,
  parseIpPattern,
} from '@az-sentinel/shared'

const GUARD_KEY = 'ip_guard'

export async function listRules(db: D1Database): Promise<IpRule[]> {
  const { results } = await db
    .prepare('SELECT id, ip, label, max_conns, created_at FROM ip_rules ORDER BY id')
    .all<IpRule>()
  return results
}

export async function listBlocked(db: D1Database): Promise<IpBlocked[]> {
  const { results } = await db
    .prepare('SELECT ip, last_at, count FROM ip_blocked ORDER BY last_at DESC LIMIT 30')
    .all<IpBlocked>()
  return results
}

export async function isEnforced(db: D1Database): Promise<boolean> {
  const row = await db
    .prepare('SELECT v FROM server_meta WHERE k = ?')
    .bind(GUARD_KEY)
    .first<{ v: string }>()
  return row?.v === '1'
}

export async function setEnforced(db: D1Database, on: boolean, now: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO server_meta (k, v, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at`,
    )
    .bind(GUARD_KEY, on ? '1' : '0', now)
    .run()
}

/** Có luật nào (trừ luật `exceptId`) cho `ip` vào không. Máy chạy Server (loopback) luôn vào được. */
export function allowedBy(rules: IpRule[], ip: string | null, exceptId?: number): boolean {
  if (ip === null || isLoopbackIp(ip)) return true
  return rules.some((r) => {
    if (r.id === exceptId) return false
    const pattern = parseIpPattern(r.ip)
    return pattern !== null && ipMatches(pattern, ip)
  })
}

/** Thêm luật. Trả null nếu IP đã có. Cho phép xong thì xóa IP đó khỏi danh sách "bị chặn". */
export async function createRule(
  db: D1Database,
  input: { ip: string; label: string; max_conns: number },
  createdBy: number,
  now: number,
): Promise<IpRule | null> {
  const exists = await db.prepare('SELECT id FROM ip_rules WHERE ip = ?').bind(input.ip).first()
  if (exists) return null
  const row = await db
    .prepare(
      `INSERT INTO ip_rules (ip, label, max_conns, created_by, created_at) VALUES (?, ?, ?, ?, ?)
       RETURNING id, ip, label, max_conns, created_at`,
    )
    .bind(input.ip, input.label, input.max_conns, createdBy, now)
    .first<IpRule>()
  await db.prepare('DELETE FROM ip_blocked WHERE ip = ?').bind(input.ip).run()
  return row
}

export async function updateRule(
  db: D1Database,
  id: number,
  patch: { label?: string; max_conns?: number },
): Promise<IpRule | null> {
  const row = await db
    .prepare(
      `UPDATE ip_rules SET label = COALESCE(?, label), max_conns = COALESCE(?, max_conns) WHERE id = ?
       RETURNING id, ip, label, max_conns, created_at`,
    )
    .bind(patch.label ?? null, patch.max_conns ?? null, id)
    .first<IpRule>()
  return row
}

export async function deleteRule(db: D1Database, id: number): Promise<boolean> {
  const res = await db.prepare('DELETE FROM ip_rules WHERE id = ?').bind(id).run()
  return (res.meta?.changes ?? 0) > 0
}
