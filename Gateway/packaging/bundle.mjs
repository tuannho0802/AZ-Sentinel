// Gom Gateway + @az-sentinel/shared + zod thành MỘT file CommonJS (dist/gateway.cjs).
// Dùng: node packaging/bundle.mjs [version]   (version mặc định lấy từ package.json)
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const version = (process.argv[2] ?? pkg.version).replace(/^gateway-v|^v/, '')

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/gateway.cjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  minify: true,
  legalComments: 'none',
  define: { 'process.env.GW_BUILD_VERSION': JSON.stringify(version) },
})
console.log(`bundle OK: dist/gateway.cjs (v${version})`)
