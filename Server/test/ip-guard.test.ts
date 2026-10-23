import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { IpGuard } from '../src/ip-guard'

function makeGuard(enforce: boolean, allowed: string[] = []): IpGuard {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE server_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at INTEGER);
    CREATE TABLE ip_rules (ip TEXT PRIMARY KEY, max_conns INTEGER NOT NULL);
    CREATE TABLE ip_blocked (ip TEXT PRIMARY KEY, last_at INTEGER NOT NULL, count INTEGER NOT NULL);
  `)
  if (enforce) db.exec("INSERT INTO server_meta (k, v) VALUES ('ip_guard', '1')")
  for (const ip of allowed) db.prepare('INSERT INTO ip_rules (ip, max_conns) VALUES (?, 5)').run(ip)
  return new IpGuard(db)
}

describe('IpGuard', () => {
  it('whitelist bật: IP lạ bị chặn ở đường thường', () => {
    const g = makeGuard(true, ['1.2.3.4'])
    expect(g.decide('9.9.9.9', '/api/me').allow).toBe(false)
    expect(g.decide('1.2.3.4', '/api/me').allow).toBe(true)
  })

  it('whitelist bật: /api/health và /api/server-info/self vẫn vào được từ IP lạ (Worker Cloudflare)', () => {
    const g = makeGuard(true, ['1.2.3.4'])
    expect(g.decide('9.9.9.9', '/api/health').allow).toBe(true)
    expect(g.decide('9.9.9.9', '/api/server-info/self').allow).toBe(true)
  })

  it('miễn trừ chỉ đúng từng đường, không lan sang đường khác', () => {
    const g = makeGuard(true)
    expect(g.decide('9.9.9.9', '/api/server-info').allow).toBe(false)
    expect(g.decide('9.9.9.9', '/api/server-info/self/x').allow).toBe(false)
  })

  it('máy chạy Server (loopback) luôn vào được', () => {
    expect(makeGuard(true).decide('127.0.0.1', '/api/me').allow).toBe(true)
  })
})
