/**
 * Tạo một liên kết EA giả trong D1 LOCAL (P1-13) và in API key MỘT LẦN.
 *   pnpm db:seed:local
 *   pnpm db:seed:local -- --login 12345678 --server Broker-Live01   (gắn sẵn tài khoản)
 *   pnpm db:seed:remote   (D1 thật trên Cloudflare, P1-21; khóa lưu ở BE/.wrangler/remote-api-key.txt)
 * Khóa cũng được ghi vào BE/.wrangler/local-api-key.txt (thư mục đã nằm trong .gitignore)
 * để fake-ea.ts tự đọc.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateApiKey } from '../BE/src/lib/crypto'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const beDir = path.join(root, 'BE')
const target = process.argv.includes('--remote') ? 'remote' : 'local'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const loginArg = arg('login')
const serverArg = arg('server')
if ((loginArg === undefined) !== (serverArg === undefined)) {
  console.error('Cần truyền cả --login và --server, hoặc không truyền cái nào.')
  process.exit(1)
}
if (loginArg !== undefined && !/^[1-9][0-9]{0,15}$/.test(loginArg)) {
  console.error('--login phải là số nguyên dương.')
  process.exit(1)
}
if (serverArg !== undefined && !/^[A-Za-z0-9 ._-]{1,128}$/.test(serverArg)) {
  console.error('--server chỉ gồm chữ, số, khoảng trắng, dấu chấm, gạch ngang, gạch dưới.')
  process.exit(1)
}

const { key, keyHash, keyPrefix } = await generateApiKey()
const now = Math.floor(Date.now() / 1000)
// Các giá trị đã được kiểm tra ký tự ở trên hoặc do mã tự sinh (hex/base64url) nên an toàn
// để đưa vào tệp SQL một lần dùng, không có dữ liệu người dùng tự do.
const login = loginArg ?? 'NULL'
const server = serverArg === undefined ? 'NULL' : `'${serverArg}'`
const sql =
  `INSERT INTO ea_links (login, server, key_hash, key_prefix, status, created_at) ` +
  `VALUES (${login}, ${server}, '${keyHash}', '${keyPrefix}', 'active', ${now});\n`

const tmpDir = path.join(beDir, '.wrangler')
mkdirSync(tmpDir, { recursive: true })
const sqlFile = path.join(tmpDir, 'seed-link.sql')
writeFileSync(sqlFile, sql)

const result = spawnSync(
  'pnpm',
  ['exec', 'wrangler', 'd1', 'execute', 'DB', `--${target}`, '--file=.wrangler/seed-link.sql'],
  { cwd: beDir, stdio: 'inherit', shell: true },
)
if (result.status !== 0) {
  console.error(`\nSeed thất bại. Đã chạy \`pnpm db:migrate:${target}\` chưa?`)
  process.exit(result.status ?? 1)
}

const keyFile = `${target}-api-key.txt`
writeFileSync(path.join(tmpDir, keyFile), `${key}\n`)
console.log(`\nĐã tạo liên kết EA giả (D1 ${target}).`)
console.log(`  API key (chỉ hiện một lần): ${key}`)
console.log(`  Tiền tố: ${keyPrefix}`)
console.log(`  Đã lưu vào BE/.wrangler/${keyFile} (thư mục bị .gitignore).`)
