// Gom máy chủ VPS (Node) + BE (Hono) + Shared thành MỘT file ESM (dist/server.mjs).
// `cloudflare:workers` (chỉ Worker mới có) được thay bằng shim của Server; migration của BE được chép
// sang dist/migrations để chạy lúc khởi động. Dùng: node build.mjs
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const pkg = JSON.parse(readFileSync(here('./package.json'), 'utf8'))

/** Thay module `cloudflare:workers` bằng shim chạy trên Node. */
const cloudflareShim = {
  name: 'cloudflare-workers-shim',
  setup(b) {
    b.onResolve({ filter: /^cloudflare:workers$/ }, () => ({
      path: here('./src/shim/cloudflare-workers.ts'),
    }))
  },
}

rmSync(here('./dist'), { recursive: true, force: true })
mkdirSync(here('./dist'), { recursive: true })

await build({
  entryPoints: [here('./src/main.ts')],
  outfile: here('./dist/server.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  legalComments: 'none',
  plugins: [cloudflareShim],
  // node:sqlite có sẵn trong Node 22.5+; ws có hai phụ thuộc tùy chọn (tăng tốc) không cần thiết.
  external: ['node:sqlite', 'bufferutil', 'utf-8-validate'],
  // `ws` là CommonJS: cần `require` khi gom vào ESM.
  banner: {
    js: "import { createRequire as __cr } from 'node:module';const require = __cr(import.meta.url);",
  },
  define: { 'process.env.AZ_SERVER_VERSION': JSON.stringify(pkg.version) },
})

cpSync(here('../BE/migrations'), here('./dist/migrations'), { recursive: true })
console.log(`build OK: Server/dist/server.mjs (v${pkg.version})`)
