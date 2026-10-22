import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@az-sentinel/shared'
import { deleteUserSessions } from '../../BE/src/services/session-service'
import {
  createUser,
  findUserByEmail,
  listUsers,
  normalizeEmail,
  setPassword,
} from '../../BE/src/services/user-service'
import type { ServerConfig } from './config'
import { runMigrations } from './migrate'
import { openDatabase } from './shim/d1'

const USAGE = `Dùng: node server.mjs user <lệnh>
  create-admin <email> <tên>   Tạo quản trị viên gốc (hỏi mật khẩu, không hiện khi gõ)
  list                         Liệt kê người dùng
  reset-password <email>       Đặt mật khẩu mới (hỏi mật khẩu) và đăng xuất mọi thiết bị

Lần đầu cài Server: chạy create-admin, rồi đăng nhập trên giao diện web bằng tài khoản đó để thêm người dùng
và cấp token Gateway. Muốn đưa mật khẩu qua đường ống (tự động hóa): thêm --password-stdin (đọc dòng đầu của stdin).`

export type SecretReader = (prompt: string) => Promise<string>

/** Đọc mật khẩu từ bàn phím mà không hiện ký tự; không phải TTY thì đọc dòng đầu của stdin. */
export const readSecretFromTerminal: SecretReader = (prompt) =>
  new Promise((resolve, reject) => {
    const stdin = process.stdin
    if (!stdin.isTTY) {
      let buf = ''
      stdin.setEncoding('utf8')
      stdin.on('data', (chunk) => {
        buf += chunk
        const nl = buf.indexOf('\n')
        if (nl >= 0) resolve(buf.slice(0, nl).replace(/\r$/, ''))
      })
      stdin.on('end', () => resolve(buf.replace(/\r?\n$/, '')))
      stdin.on('error', reject)
      return
    }
    process.stdout.write(prompt)
    let value = ''
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false)
          stdin.pause()
          stdin.off('data', onData)
          process.stdout.write('\n')
          resolve(value)
          return
        }
        if (ch === '\u0003') {
          stdin.setRawMode(false)
          process.stdout.write('\n')
          process.exit(130)
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1)
        else value += ch
      }
    }
    stdin.on('data', onData)
  })

const fmt = (t: number) => new Date(t * 1000).toISOString()

async function askNewPassword(read: SecretReader, fromStdin: boolean): Promise<string | null> {
  const first = await read('Mật khẩu mới: ')
  if (first.length < PASSWORD_MIN_LENGTH || first.length > PASSWORD_MAX_LENGTH) {
    console.error(`Mật khẩu phải từ ${PASSWORD_MIN_LENGTH} đến ${PASSWORD_MAX_LENGTH} ký tự.`)
    return null
  }
  if (!fromStdin && (await read('Nhập lại mật khẩu: ')) !== first) {
    console.error('Hai lần nhập không khớp.')
    return null
  }
  return first
}

/** Quản lý người dùng bằng dòng lệnh, trực tiếp trên SQLite của VPS. Trả mã thoát. */
export async function runUserCli(
  cfg: ServerConfig,
  args: string[],
  read: SecretReader = readSecretFromTerminal,
): Promise<number> {
  const fromStdin = args.includes('--password-stdin')
  const [cmd, a, ...rest] = args.filter((x) => x !== '--password-stdin')
  if (!cmd || !['create-admin', 'list', 'reset-password'].includes(cmd)) {
    console.log(USAGE)
    return cmd ? 1 : 0
  }
  const sqlite = openDatabase(cfg.dbFile)
  runMigrations(sqlite, cfg.migrationsDir)
  const db = sqlite as unknown as D1Database
  const now = Math.floor(Date.now() / 1000)
  try {
    if (cmd === 'list') {
      const users = await listUsers(db)
      if (users.length === 0)
        console.log('(chưa có người dùng nào; chạy create-admin để tạo admin đầu tiên)')
      for (const u of users) {
        console.log(
          `#${u.id}\t${u.role}\t${u.status}\t${u.email}\t${u.display_name}\ttoken=${u.has_token ? 'có' : 'chưa'}\ttạo=${fmt(u.created_at)}`,
        )
      }
      return 0
    }
    const email = normalizeEmail(a ?? '')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      console.error('Thiếu hoặc sai email.\n')
      console.log(USAGE)
      return 1
    }
    if (cmd === 'create-admin') {
      const name = rest.join(' ').trim().slice(0, 64)
      if (name === '') {
        console.error('Thiếu tên hiển thị.\n')
        console.log(USAGE)
        return 1
      }
      if (await findUserByEmail(db, email)) {
        console.error(`Email ${email} đã có tài khoản. Muốn đổi mật khẩu hãy dùng reset-password.`)
        return 1
      }
      const password = await askNewPassword(read, fromStdin)
      if (password === null) return 1
      const row = await createUser(
        db,
        { email, displayName: name, password, role: 'root_admin' },
        now,
      )
      console.log(
        `Đã tạo quản trị viên gốc #${row.id} (${email}). Đăng nhập trên giao diện web để tiếp tục.`,
      )
      return 0
    }
    const user = await findUserByEmail(db, email)
    if (!user) {
      console.error(`Không tìm thấy người dùng ${email}.`)
      return 1
    }
    const password = await askNewPassword(read, fromStdin)
    if (password === null) return 1
    await setPassword(db, user.id, password)
    await deleteUserSessions(db, user.id)
    console.log(`Đã đặt mật khẩu mới cho ${email} và đăng xuất mọi thiết bị.`)
    return 0
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  } finally {
    sqlite.sqlite.close()
  }
}
