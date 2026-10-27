import type { DatabaseSync } from 'node:sqlite'
import {
  DEVICE_ADOPT_LIMIT,
  DEVICE_ADOPT_META_KEY,
  DEVICE_ADOPT_PREFIX,
  DEVICE_ADOPT_WINDOW_SEC,
  DEVICE_AUTO_IP_LIMIT,
  type DeviceMode,
  IP_RULE_DEFAULT_MAX_CONNS,
  type IpPattern,
  ipMatches,
  isLoopbackIp,
  parseIpPattern,
  shortDeviceId,
} from '@az-sentinel/shared'
import type { DeviceInfo } from './device-id'

type Rule = { pattern: IpPattern; maxConns: number }
type DeviceRow = { mode: DeviceMode; label: string }

/** `reason`: `ip` = IP chưa được phép; `device` = bật "chỉ thiết bị đã duyệt" mà thiết bị này chưa được duyệt. */
export type BlockReason = 'ip' | 'device'
export type Decision =
  | { allow: true; maxConns: number | null }
  | { allow: false; reason: BlockReason }

const CACHE_MS = 5_000
const NOTE_EVERY_MS = 30_000
const KEEP_BLOCKED = 50
const KEEP_PENDING = 200
const TOUCH_EVERY_MS = 60_000

/**
 * Đường luôn vào được dù whitelist đang bật (không phụ thuộc IP):
 * - `/api/health`: dò sống/chết.
 * - `/api/server-info/self`: Worker Cloudflare gọi bằng token dịch vụ `SYNC_TOKEN` (đường tự yêu cầu token, sai
 *   thì 401) để lấy thông tin VPS. Request này đi từ IP của Cloudflare, không bao giờ có trong whitelist; bị
 *   chặn thì Worker coi VPS đã sập và hiện banner "Máy chủ chính không hoạt động" dù VPS vẫn chạy.
 */
const ALWAYS_ALLOWED_PATHS = new Set(['/api/health', '/api/server-info/self'])

/**
 * Whitelist IP của máy chủ VPS (Plan 3F). Luật nằm trong SQLite (`ip_rules`, công tắc ở `server_meta`) nên
 * còn nguyên khi Server khởi động lại hoặc VPS reset: Gateway của các IP trong danh sách tự nối lại là vào
 * được ngay, không phải làm gì thêm. Đọc luật có đệm 5 giây để admin sửa trên web có hiệu lực nhanh mà
 * không phải đọc DB mỗi request.
 * - Máy chạy Server (loopback không qua tunnel), `/api/health` và `/api/server-info/self` (cần token dịch vụ) luôn vào được.
 * - Công tắc tắt: ai cũng vào, nhưng IP có trong danh sách vẫn bị giới hạn số kết nối WebSocket.
 * - Công tắc bật: chỉ IP khớp luật mới vào; IP lạ bị chặn và ghi vào `ip_blocked` để admin cho phép.
 *
 * Whitelist THIẾT BỊ (`device_rules`, công tắc `device_guard`, mặc định tắt) chạy cùng chỗ:
 * - Công tắc thiết bị bật: thiết bị chưa duyệt (hoặc request không mang mã thiết bị) bị chặn dù IP hợp lệ; thiết bị lạ
 *   được ghi vào `device_pending` để admin duyệt.
 * - Thiết bị `any_ip`: vào bằng IP nào thì IP đó được thêm vào `ip_rules` (đánh dấu `device_id`) và vào luôn.
 * - Thiết bị `device_only`: chỉ qua cổng thiết bị; IP vẫn phải khớp whitelist IP (khi bật) như người thường.
 */
export class IpGuard {
  private enforce = false
  private deviceEnforce = false
  private adoptEnabled = true
  private rules: Rule[] = []
  private devices = new Map<string, DeviceRow>()
  private readonly touched = new Map<string, number>()
  private loadedAt = 0
  private readonly open = new Map<string, number>()
  private readonly noted = new Map<string, number>()

  constructor(
    private readonly sqlite: DatabaseSync,
    private readonly now: () => number = Date.now,
    private readonly onError: (message: string) => void = () => {},
  ) {}

  decide(ip: string, pathname: string, device: DeviceInfo | null = null): Decision {
    if (ip === '' || isLoopbackIp(ip) || ALWAYS_ALLOWED_PATHS.has(pathname)) {
      return { allow: true, maxConns: null }
    }
    this.load()
    let known = device ? this.devices.get(device.id) : undefined
    if (this.deviceEnforce && !known && device)
      known = this.adoptSameMachine(device, ip) ?? undefined
    if (this.deviceEnforce && !known) return { allow: false, reason: 'device' }
    if (device && known) this.touch(device.id, ip)
    if (device && known?.mode === 'any_ip') {
      const maxConns = this.trustIp(device.id, known.label, ip)
      if (maxConns !== null) return { allow: true, maxConns }
    }
    const rule = this.rules.find((r) => ipMatches(r.pattern, ip))
    if (rule) return { allow: true, maxConns: rule.maxConns }
    return this.enforce ? { allow: false, reason: 'ip' } : { allow: true, maxConns: null }
  }

  /**
   * Ghi request bị chặn cho admin xem (mỗi IP + thiết bị tối đa 30 giây một lần ghi, giữ 50 dòng mới nhất).
   * Có mã thiết bị thì gắn vào dòng IP bị chặn, và nếu thiết bị chưa được duyệt thì ghi vào danh sách chờ duyệt.
   */
  noteBlocked(ip: string, device: DeviceInfo | null = null): void {
    const t = this.now()
    const key = `${ip}|${device?.id ?? ''}`
    if (t - (this.noted.get(key) ?? 0) < NOTE_EVERY_MS) return
    this.noted.set(key, t)
    if (this.noted.size > 1000) this.noted.clear()
    try {
      const sec = Math.floor(t / 1000)
      if (device) {
        this.sqlite
          .prepare(
            `INSERT INTO ip_blocked (ip, last_at, count, device_id) VALUES (?, ?, 1, ?)
             ON CONFLICT(ip) DO UPDATE SET last_at = excluded.last_at, count = count + 1, device_id = excluded.device_id`,
          )
          .run(ip, sec, device.id)
      } else {
        this.sqlite
          .prepare(
            `INSERT INTO ip_blocked (ip, last_at, count) VALUES (?, ?, 1)
             ON CONFLICT(ip) DO UPDATE SET last_at = excluded.last_at, count = count + 1`,
          )
          .run(ip, sec)
      }
      this.sqlite
        .prepare(
          `DELETE FROM ip_blocked WHERE ip NOT IN (SELECT ip FROM ip_blocked ORDER BY last_at DESC LIMIT ${KEEP_BLOCKED})`,
        )
        .run()
    } catch (error) {
      this.onError(`không ghi được IP bị chặn: ${String(error).slice(0, 120)}`)
    }
    if (device && !this.devices.has(device.id)) this.notePending(ip, device, Math.floor(t / 1000))
  }

  private notePending(ip: string, device: DeviceInfo, sec: number): void {
    try {
      this.sqlite
        .prepare(
          `INSERT INTO device_pending (device_id, kind, ip, user_agent, last_at, count) VALUES (?, ?, ?, ?, ?, 1)
           ON CONFLICT(device_id) DO UPDATE SET ip = excluded.ip, user_agent = excluded.user_agent,
             last_at = excluded.last_at, count = count + 1`,
        )
        .run(device.id, device.kind, ip, device.ua, sec)
      this.sqlite
        .prepare(
          `DELETE FROM device_pending WHERE device_id NOT IN (SELECT device_id FROM device_pending ORDER BY last_at DESC LIMIT ${KEEP_PENDING})`,
        )
        .run()
    } catch (error) {
      this.onError(`không ghi được thiết bị chờ duyệt: ${String(error).slice(0, 120)}`)
    }
  }

  /** Nội dung thông báo 403 cho người bị chặn (kèm mã thiết bị để họ gửi cho admin). */
  describeBlock(ip: string, reason: BlockReason, device: DeviceInfo | null): string {
    if (reason === 'ip') {
      return `IP ${ip} chưa được cho phép truy cập máy chủ này. Nhờ quản trị viên thêm IP này vào whitelist.`
    }
    return device
      ? `Thiết bị này (mã ${shortDeviceId(device.id)}, IP ${ip}) chưa được cho phép. Nhờ quản trị viên duyệt thiết bị trong trang Whitelist.`
      : `Không nhận diện được thiết bị (IP ${ip}). Hãy dùng trình duyệt bình thường hoặc cập nhật Gateway, rồi nhờ quản trị viên duyệt thiết bị.`
  }

  /** Cập nhật IP và lần thấy cuối của thiết bị đã duyệt (tối đa mỗi phút một lần mỗi thiết bị). */
  private touch(deviceId: string, ip: string): void {
    const t = this.now()
    if (t - (this.touched.get(deviceId) ?? 0) < TOUCH_EVERY_MS) return
    this.touched.set(deviceId, t)
    if (this.touched.size > 1000) this.touched.clear()
    try {
      this.sqlite
        .prepare('UPDATE device_rules SET last_ip = ?, last_seen = ? WHERE device_id = ?')
        .run(ip, Math.floor(t / 1000), deviceId)
    } catch (error) {
      this.onError(`không ghi được lần thấy cuối của thiết bị: ${String(error).slice(0, 120)}`)
    }
  }

  /**
   * Thiết bị `any_ip`: bảo đảm `ip` có trong whitelist IP rồi trả số kết nối tối đa của luật đó. IP đã khớp luật
   * nào thì dùng luật đó (không ghi đè). Mỗi thiết bị giữ tối đa `DEVICE_AUTO_IP_LIMIT` IP tự thêm (bỏ IP cũ nhất).
   * Trả null khi không thêm được (IP sai định dạng hoặc lỗi DB) để rơi về kiểm tra IP thông thường.
   */
  private trustIp(deviceId: string, label: string, ip: string): number | null {
    const existing = this.rules.find((r) => ipMatches(r.pattern, ip))
    if (existing) return existing.maxConns
    const pattern = parseIpPattern(ip)
    if (!pattern || (pattern.kind === 'v4' && pattern.bits !== 32)) return null
    try {
      const sec = Math.floor(this.now() / 1000)
      this.sqlite
        .prepare(
          `INSERT OR IGNORE INTO ip_rules (ip, label, max_conns, created_by, created_at, device_id)
           VALUES (?, ?, ?, 0, ?, ?)`,
        )
        .run(
          pattern.text,
          `Thiết bị: ${label || shortDeviceId(deviceId)}`.slice(0, 64),
          IP_RULE_DEFAULT_MAX_CONNS,
          sec,
          deviceId,
        )
      this.sqlite
        .prepare(
          `DELETE FROM ip_rules WHERE device_id = ? AND id NOT IN
             (SELECT id FROM ip_rules WHERE device_id = ? ORDER BY id DESC LIMIT ${DEVICE_AUTO_IP_LIMIT})`,
        )
        .run(deviceId, deviceId)
      this.sqlite.prepare('DELETE FROM ip_blocked WHERE ip = ?').run(pattern.text)
      this.rules.push({ pattern, maxConns: IP_RULE_DEFAULT_MAX_CONNS })
      this.loadedAt = 0 // đọc lại danh sách thật ở request kế tiếp (một số IP cũ vừa bị bỏ)
      return IP_RULE_DEFAULT_MAX_CONNS
    } catch (error) {
      this.onError(`không tự thêm được IP của thiết bị: ${String(error).slice(0, 120)}`)
      return null
    }
  }

  /**
   * "Cùng máy": thiết bị web lạ đến từ IP mà một thiết bị web ĐÃ được quản trị viên duyệt vừa dùng thì duyệt theo
   * (xem `DEVICE_ADOPT_WINDOW_SEC`). Chỉ khi thiết bị gốc là web do người duyệt (không phải loại tự duyệt,
   * không có chuyện duyệt dây chuyền) và, khi whitelist IP đang bật, IP đó thực sự nằm trong whitelist (bằng chứng
   * thiết bị gốc vào được bằng IP này). Gateway không bao giờ được duyệt kiểu này. Trả null nếu không duyệt.
   */
  private adoptSameMachine(device: DeviceInfo, ip: string): DeviceRow | null {
    if (!this.adoptEnabled || device.kind !== 'web') return null
    if (this.enforce && !this.rules.some((r) => ipMatches(r.pattern, ip))) return null
    try {
      const nowSec = Math.floor(this.now() / 1000)
      const taken = this.sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM device_rules WHERE created_by = 0 AND kind = 'web' AND last_ip = ?",
        )
        .get(ip) as { n: number }
      if (taken.n >= DEVICE_ADOPT_LIMIT) return null
      const source = this.sqlite
        .prepare(
          `SELECT d.label, d.mode FROM device_rules d
           WHERE d.kind = 'web' AND d.device_id != ? AND COALESCE(d.created_by, -1) != 0
             AND ((d.last_ip = ? AND d.last_seen >= ?)
               OR EXISTS (SELECT 1 FROM ip_rules r WHERE r.device_id = d.device_id AND r.ip = ?))
           ORDER BY d.last_seen DESC LIMIT 1`,
        )
        .get(device.id, ip, nowSec - DEVICE_ADOPT_WINDOW_SEC, ip) as DeviceRow | undefined
      if (!source) return null
      const label = `${DEVICE_ADOPT_PREFIX}${source.label || 'thiết bị đã duyệt'}`.slice(0, 64)
      this.sqlite
        .prepare(
          `INSERT OR IGNORE INTO device_rules (device_id, kind, label, mode, last_ip, last_seen, created_by, created_at)
           VALUES (?, 'web', ?, ?, ?, ?, 0, ?)`,
        )
        .run(device.id, label, source.mode, ip, nowSec, nowSec)
      this.sqlite.prepare('DELETE FROM device_pending WHERE device_id = ?').run(device.id)
      const row: DeviceRow = { mode: source.mode, label }
      this.devices.set(device.id, row)
      return row
    } catch (error) {
      this.onError(`không tự duyệt được thiết bị cùng máy: ${String(error).slice(0, 120)}`)
      return null
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
    this.loadDevices()
  }

  /** Đọc whitelist thiết bị. Chưa có bảng (DB cũ chưa migrate) thì coi như tắt; lỗi khác giữ nguyên luật cũ. */
  private loadDevices(): void {
    try {
      const flag = this.sqlite
        .prepare("SELECT v FROM server_meta WHERE k = 'device_guard'")
        .get() as { v: string } | undefined
      const rows = this.sqlite.prepare('SELECT device_id, mode, label FROM device_rules').all() as {
        device_id: string
        mode: DeviceMode
        label: string
      }[]
      this.devices = new Map(rows.map((r) => [r.device_id, { mode: r.mode, label: r.label }]))
      this.deviceEnforce = flag?.v === '1'
      const adopt = this.sqlite
        .prepare('SELECT v FROM server_meta WHERE k = ?')
        .get(DEVICE_ADOPT_META_KEY) as { v: string } | undefined
      this.adoptEnabled = adopt?.v !== '0'
    } catch (error) {
      if (String(error).includes('no such table')) return
      this.onError(`không đọc được whitelist thiết bị: ${String(error).slice(0, 120)}`)
    }
  }
}
