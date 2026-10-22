import {
  createToken,
  listTokens,
  resetToken,
  revokeToken,
} from '../../BE/src/services/gw-token-service'
import type { ServerConfig } from './config'
import { runMigrations } from './migrate'
import { openDatabase } from './shim/d1'

const USAGE = `Dùng: node server.mjs token <lệnh>
  issue <owner_id> <tên>   Cấp token Gateway cho một người (mỗi người một token đang hoạt động)
  list                     Liệt kê token (không hiện token thô)
  reset <id>               Đặt lại: token cũ chết ngay, in token mới
  revoke <id>              Thu hồi vĩnh viễn

Token thô chỉ in MỘT lần. Gửi nó cho đúng người đó để nhập vào Gateway.
Server đang chạy tự đồng bộ thay đổi sang Cloudflare. Gateway đang nối bằng token cũ bị ngắt khi nối lại
(lệnh này ghi thẳng SQLite nên không ngắt được ngay; muốn ngắt ngay hãy đổi qua trang Token trên giao diện).`

const fmt = (t: number | null) => (t === null ? '-' : new Date(t * 1000).toISOString())

/** Quản lý token Gateway bằng dòng lệnh, trực tiếp trên SQLite của VPS. Trả mã thoát. */
export async function runTokenCli(cfg: ServerConfig, args: string[]): Promise<number> {
  const [cmd, a, ...rest] = args
  if (!cmd || !['issue', 'list', 'reset', 'revoke'].includes(cmd)) {
    console.log(USAGE)
    return cmd ? 1 : 0
  }
  const sqlite = openDatabase(cfg.dbFile)
  runMigrations(sqlite, cfg.migrationsDir)
  const db = sqlite as unknown as D1Database
  const now = Math.floor(Date.now() / 1000)
  try {
    if (cmd === 'list') {
      const rows = await listTokens(db)
      if (rows.length === 0) console.log('(chưa có token nào)')
      for (const r of rows) {
        console.log(
          `#${r.id}\t${r.status}\towner=${r.owner_id}\t${r.token_prefix}…\t${r.label}\tcấp=${fmt(r.created_at)}\tdùng=${fmt(r.last_used_at)}`,
        )
      }
      return 0
    }
    if (cmd === 'issue') {
      const ownerId = Number(a)
      const label = rest.join(' ').trim()
      if (!Number.isInteger(ownerId) || ownerId <= 0 || label === '') {
        console.error('Thiếu hoặc sai tham số.\n')
        console.log(USAGE)
        return 1
      }
      const { token, row } = await createToken(db, { ownerId, label: label.slice(0, 64) }, now)
      console.log(
        `Đã cấp token #${row.id} cho ${label} (owner ${ownerId}). Chỉ hiện một lần:\n\n${token}\n`,
      )
      return 0
    }
    const id = Number(a)
    if (!Number.isInteger(id) || id <= 0) {
      console.error('id không hợp lệ.\n')
      console.log(USAGE)
      return 1
    }
    if (cmd === 'reset') {
      const out = await resetToken(db, id)
      if (!out) {
        console.error(`Không tìm thấy token #${id}`)
        return 1
      }
      console.log(
        `Đã đặt lại token #${id}. Token cũ không còn dùng được. Token mới (chỉ hiện một lần):\n\n${out.token}\n`,
      )
      return 0
    }
    const row = await revokeToken(db, id, now)
    if (!row) {
      console.error(`Không tìm thấy token #${id}`)
      return 1
    }
    console.log(`Đã thu hồi token #${id} (${row.label}).`)
    return 0
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  } finally {
    sqlite.sqlite.close()
  }
}
