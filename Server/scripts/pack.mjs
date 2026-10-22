// Gom bản chạy cho VPS vào Server/release/az-server (chạy sau `node build.mjs`):
//   server.mjs, migrations/, web/ (FE/dist), scripts/, server.env.example
// Dùng: pnpm pack:server   (tự build FE trước)
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const out = here('../release/az-server')
const web = here('../../FE/dist')

if (!existsSync(here('../dist/server.mjs')))
  throw new Error('Chưa build: chạy `node build.mjs` trước')
if (!existsSync(web))
  throw new Error('Chưa build giao diện: chạy `pnpm build:web` (hoặc `pnpm pack:server`)')

rmSync(here('../release'), { recursive: true, force: true })
mkdirSync(out, { recursive: true })
cpSync(here('../dist/server.mjs'), `${out}/server.mjs`)
cpSync(here('../dist/migrations'), `${out}/migrations`, { recursive: true })
cpSync(web, `${out}/web`, { recursive: true })
for (const f of [
  'run-server.cmd',
  'token.cmd',
  'install-task.ps1',
  'uninstall-task.ps1',
  'stop-server.ps1',
  'token-shell.ps1',
  'open-firewall.ps1',
  'check-server.ps1',
  'server.env.example',
]) {
  cpSync(here(`./${f}`), `${out}/${f}`)
}
console.log(`pack OK: ${out}`)
console.log(
  'Chép thư mục này lên VPS, copy server.env.example thành server.env rồi điền cấu hình (xem Docs/AZ_Sentinel_Plan3E_VPS_Primary.md).',
)
