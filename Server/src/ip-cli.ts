import {
  IP_RULE_DEFAULT_MAX_CONNS,
  IP_RULE_MAX_CONNS_LIMIT,
  parseIpPattern,
} from '@az-sentinel/shared'
import {
  createRule,
  isEnforced,
  listRules,
  setEnforced,
} from '../../BE/src/services/ip-rules-service'
import type { ServerConfig } from './config'
import { runMigrations } from './migrate'
import { openDatabase } from './shim/d1'

const USAGE = `Dùng: node server.mjs ip <lệnh>
  list                              Xem công tắc và danh sách IP được phép
  add <ip|cidr> [nhãn] [--max N]    Thêm IP (1.2.3.4) hoặc dải (1.2.3.0/24); N = số kết nối tối đa (mặc định ${IP_RULE_DEFAULT_MAX_CONNS})
  remove <ip|cidr>                  Bỏ một IP khỏi danh sách
  on | off                          Bật/tắt "chỉ IP trong danh sách mới vào được"

Công tắc mặc định TẮT. Lệnh này chạy trên chính máy Server nên luôn dùng được, kể cả khi bạn tự khóa mình ngoài web.
Thay đổi có hiệu lực trong vài giây, không cần khởi động lại Server.`

/** Quản lý whitelist IP bằng dòng lệnh, trực tiếp trên SQLite của VPS. Trả mã thoát. */
export async function runIpCli(cfg: ServerConfig, args: string[]): Promise<number> {
  const [cmd, ...rest] = args
  if (!cmd || !['list', 'add', 'remove', 'on', 'off'].includes(cmd)) {
    console.log(USAGE)
    return cmd ? 1 : 0
  }
  const sqlite = openDatabase(cfg.dbFile)
  runMigrations(sqlite, cfg.migrationsDir)
  const db = sqlite as unknown as D1Database
  const now = Math.floor(Date.now() / 1000)
  try {
    if (cmd === 'list') {
      const [on, rules] = await Promise.all([isEnforced(db), listRules(db)])
      console.log(`Chế độ chỉ cho IP trong danh sách: ${on ? 'BẬT' : 'TẮT'}`)
      if (rules.length === 0) console.log('(danh sách trống)')
      for (const r of rules)
        console.log(`#${r.id}\t${r.ip}\ttối đa ${r.max_conns} kết nối\t${r.label}`)
      return 0
    }
    if (cmd === 'on' || cmd === 'off') {
      if (cmd === 'on' && (await listRules(db)).length === 0) {
        console.log(
          'Lưu ý: danh sách trống, chỉ máy chạy Server mới vào được cho tới khi bạn thêm IP.',
        )
      }
      await setEnforced(db, cmd === 'on', now)
      console.log(
        cmd === 'on' ? 'Đã BẬT: chỉ IP trong danh sách mới vào được.' : 'Đã TẮT: ai cũng vào được.',
      )
      return 0
    }
    // add | remove
    const words: string[] = []
    let max = IP_RULE_DEFAULT_MAX_CONNS
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--max') {
        max = Number(rest[++i])
      } else {
        words.push(rest[i] ?? '')
      }
    }
    const pattern = parseIpPattern(words[0] ?? '')
    if (!pattern) {
      console.error('IP hoặc dải CIDR không hợp lệ (ví dụ 1.2.3.4 hoặc 1.2.3.0/24).')
      return 1
    }
    if (cmd === 'add') {
      if (!Number.isInteger(max) || max < 1 || max > IP_RULE_MAX_CONNS_LIMIT) {
        console.error(`--max phải từ 1 đến ${IP_RULE_MAX_CONNS_LIMIT}.`)
        return 1
      }
      const rule = await createRule(
        db,
        { ip: pattern.text, label: words.slice(1).join(' ').slice(0, 64), max_conns: max },
        0,
        now,
      )
      console.log(
        rule
          ? `Đã thêm ${rule.ip} (tối đa ${rule.max_conns} kết nối).`
          : `${pattern.text} đã có trong danh sách.`,
      )
      return 0
    }
    const res = await db.prepare('DELETE FROM ip_rules WHERE ip = ?').bind(pattern.text).run()
    console.log(
      (res.meta?.changes ?? 0) > 0
        ? `Đã bỏ ${pattern.text}.`
        : `${pattern.text} không có trong danh sách.`,
    )
    return 0
  } finally {
    sqlite.sqlite.close()
  }
}
