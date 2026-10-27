import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { SERVED_BY_HEADER } from '@az-sentinel/shared'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
}

const baseHeaders = (type: string, size: number, cache: string): Record<string, string> => ({
  'Content-Type': type,
  'Content-Length': String(size),
  'Cache-Control': cache,
  'X-Content-Type-Options': 'nosniff',
  [SERVED_BY_HEADER]: 'vps',
})

/**
 * PWA chỉ cài được từ địa chỉ Worker (cố định). Địa chỉ tunnel đổi mỗi lần VPS chạy lại nên ứng dụng cài từ đó sẽ
 * chết ở lần sau: bản `index.html` do VPS phục vụ bỏ dòng khai báo manifest (đánh dấu `data-az-pwa`) để trình duyệt
 * không mời cài ở đây. Giao diện nhận ra điều đó qua việc thiếu thẻ manifest.
 */
export const stripPwaLink = (html: string): string =>
  html.replace(/[ \t]*<link\b[^>]*\bdata-az-pwa\b[^>]*>[ \t]*\r?\n?/gi, '')

/**
 * Phục vụ giao diện (FE/dist) từ VPS để không tốn request Cloudflare. Quy tắc giống
 * `not_found_handling: single-page-application` của Workers: đường dẫn không phải tệp thì trả
 * `index.html`; đường dẫn có đuôi tệp mà không tồn tại thì 404 thật. `assets/*` có băm tên nên cache
 * vĩnh viễn, còn lại không cache.
 */
export function createStaticHandler(root: string) {
  const base = path.resolve(root)

  const tryFile = async (abs: string) => {
    try {
      const info = await stat(abs)
      return info.isFile() ? info : null
    } catch {
      return null
    }
  }

  return async function serve(req: Request): Promise<Response> {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } })
    }
    let pathname: string
    try {
      pathname = decodeURIComponent(new URL(req.url).pathname)
    } catch {
      return new Response('Bad Request', { status: 400 })
    }
    if (pathname.includes('\0')) return new Response('Bad Request', { status: 400 })

    let rel = path.posix.normalize(`/${pathname}`).slice(1)
    if (rel === '' || pathname.endsWith('/')) rel = path.posix.join(rel, 'index.html')
    let abs = path.resolve(base, rel)
    if (abs !== base && !abs.startsWith(base + path.sep)) {
      return new Response('Forbidden', { status: 403 })
    }

    let info = await tryFile(abs)
    if (!info) {
      if (path.extname(rel) !== '') return new Response('Not Found', { status: 404 })
      abs = path.join(base, 'index.html')
      info = await tryFile(abs)
      if (!info) return new Response('Chưa có bản build giao diện (Server/web)', { status: 404 })
    }
    const isAsset = rel.startsWith('assets/') && abs !== path.join(base, 'index.html')
    const cache = isAsset ? 'public, max-age=31536000, immutable' : 'no-cache'
    const type = TYPES[path.extname(abs).toLowerCase()] ?? 'application/octet-stream'
    if (path.basename(abs) === 'index.html' && abs === path.join(base, 'index.html')) {
      const html = stripPwaLink(await readFile(abs, 'utf8'))
      const bytes = Buffer.from(html, 'utf8')
      const h = baseHeaders(type, bytes.length, cache)
      if (req.method === 'HEAD') return new Response(null, { status: 200, headers: h })
      return new Response(bytes, { status: 200, headers: h })
    }
    const headers = baseHeaders(type, info.size, cache)
    if (req.method === 'HEAD') return new Response(null, { status: 200, headers })
    const body = Readable.toWeb(createReadStream(abs)) as unknown as ReadableStream
    return new Response(body, { status: 200, headers })
  }
}
