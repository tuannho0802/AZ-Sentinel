import type { DatabaseSync } from 'node:sqlite'
import { type IpPattern, ipMatches, isLoopbackIp, parseIpPattern } from '@az-sentinel/shared'

type Rule = { pattern: IpPattern; maxConns: number }

export type Decision = { allow: true; maxConns: number | null } | { allow: false }

const CACHE_MS = 5_000
const NOTE_EVERY_MS = 30_000
const KEEP_BLOCKED = 50

/**
 * Whitelist IP của máy chủ VPS (Plan 3F). Luật nằm trong SQLite (`ip_rules`, công tắc ở `server_meta`) nên
 * còn nguyên khi Server khởi động lại hoặc VPS reset: Gateway của các IP trong danh sách tự nối lại là vào
 * được ngay, không phải làm gì thêm. Đọc luật có đệm 5 giây để admin sửa trên web có hiệu lực nhanh mà
 * không phải đọc DB mỗi request.
 * - Máy chạy Server (loopback không qua tunnel) và `/api/health` luôn vào được.
 * - Công tắc tắt: ai cũng vào, nhưng IP có trong danh sách vẫn bị giới hạn số kết nối WebSocket.
 * - Công tắc bật: chỉ IP khớp luật mới vào; IP lạ bị chặn và ghi vào `ip_blocked` để admin cho phép.
 */
export class IpGuard {
  private enforce = false
  private rules: Rule[] = []
  private loadedAt = 0
  private readonly open = new Map<string, number>()
  private readonly noted = new Map<string, number>()

  constructor(
    private readonly sqlite: DatabaseSync,
    private readonly now: () => number = Date.now,
    private readonly onError: (message: string) => void = () => {},
  ) {}

  decide(ip: string, pathname: string): Decision {
    if (ip === '' || isLoopbackIp(ip) || pathname === '/api/health') {
      return { allow: true, maxConns: null }
    }
    this.load()
    const rule = this.rules.find((r) => ipMatches(r.pattern, ip))
    if (rule) return { allow: true, maxConns: rule.maxConns }
    return this.enforce ? { allow: false } : { allow: true, maxConns: null }
  }

  /** Ghi IP bị chặn cho admin xem (mỗi IP tối đa 30 giây một lần ghi, giữ 50 dòng mới nhất). */
  noteBlocked(ip: string): void {
    const t = this.now()
    if (t - (this.noted.get(ip) ?? 0) < NOTE_EVERY_MS) return
    this.noted.set(ip, t)
    if (this.noted.size > 1000) this.noted.clear()
    try {
      const sec = Math.floor(t / 1000)
      this.sqlite
        .prepare(
          `INSERT INTO ip_blocked (ip, last_at, count) VALUES (?, ?, 1)
           ON CONFLICT(ip) DO UPDATE SET last_at = excluded.last_at, count = count + 1`,
        )
        .run(ip, sec)
      this.sqlite
        .prepare(
          `DELETE FROM ip_blocked WHERE ip NOT IN (SELECT ip FROM ip_blocked ORDER BY last_at DESC LIMIT ${KEEP_BLOCKED})`,
        )
        .run()
    } catch (error) {
      this.onError(`không ghi được IP bị chặn: ${String(error).slice(0, 120)}`)
    }
  }

  /** Giữ một chỗ kết nối cho IP; null nếu IP đã đủ `max` kết nối. Gọi hàm trả về khi kết nối đóng. */
  acquire(ip: string, max: number): (() => void) | null {
    const current = this.open.get(ip) ?? 0
    if (current >= max) return null
    this.open.set(ip, current + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      const left = (this.open.get(ip) ?? 1) - 1
      if (left <= 0) this.open.delete(ip)
      else this.open.set(ip, left)
    }
  }

  private load(): void {
    const t = this.now()
    if (t - this.loadedAt < CACHE_MS) return
    this.loadedAt = t
    try {
      const flag = this.sqlite.prepare("SELECT v FROM server_meta WHERE k = 'ip_guard'").get() as
        | { v: string }
        | undefined
      const rows = this.sqlite.prepare('SELECT ip, max_conns FROM ip_rules').all() as {
        ip: string
        max_conns: number
      }[]
      const rules: Rule[] = []
      for (const r of rows) {
        const pattern = parseIpPattern(r.ip)
        if (pattern) rules.push({ pattern, maxConns: r.max_conns })
      }
      this.enforce = flag?.v === '1'
      this.rules = rules
    } catch (error) {
      // Giữ luật cũ nếu lần đọc này lỗi (ví dụ DB đang khóa); không đổi từ "chặn" sang "mở" vì lỗi.
      this.onError(`không đọc được whitelist IP: ${String(error).slice(0, 120)}`)
    }
  }
}
