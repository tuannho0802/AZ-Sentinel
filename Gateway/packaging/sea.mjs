// Đóng gói dist/gateway.cjs thành MỘT file chạy được, không cần cài Node (Node SEA).
// Chạy trên máy đích (Windows -> az-gateway.exe). Cần: node >= 22, đã chạy packaging/bundle.mjs.
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'

const win = process.platform === 'win32'
const out = win ? 'dist/az-gateway.exe' : 'dist/az-gateway'
mkdirSync('dist', { recursive: true })

writeFileSync(
  'dist/sea-config.json',
  JSON.stringify({
    main: 'dist/gateway.cjs',
    output: 'dist/sea-prep.blob',
    disableExperimentalSEAWarning: true,
    useCodeCache: false,
  }),
)
execFileSync(process.execPath, ['--experimental-sea-config', 'dist/sea-config.json'], { stdio: 'inherit' })
copyFileSync(process.execPath, out)

const args = [
  'postject',
  out,
  'NODE_SEA_BLOB',
  'dist/sea-prep.blob',
  '--sentinel-fuse',
  'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
]
if (process.platform === 'darwin') args.push('--macho-segment-name', 'NODE_SEA')
execFileSync(win ? 'pnpm.cmd' : 'pnpm', ['exec', ...args], { stdio: 'inherit' })
console.log(`SEA OK: ${out}`)
