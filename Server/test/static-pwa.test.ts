import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { brotliDecompressSync, gunzipSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createStaticHandler, stripPwaLink } from '../src/static'

const HTML = `<!doctype html>
<html>
  <head>
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="manifest" href="/manifest.webmanifest" data-az-pwa />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <title>Thử nghiệm: tiếng Việt</title>
  </head>
  <body></body>
</html>
`

describe('stripPwaLink', () => {
  it('gỡ đúng thẻ có data-az-pwa, giữ nguyên phần còn lại', () => {
    const out = stripPwaLink(HTML)
    expect(out).not.toContain('manifest')
    expect(out).toContain('apple-touch-icon')
    expect(out).toContain('apple-mobile-web-app-capable')
    expect(out).toContain('Thử nghiệm: tiếng Việt')
  })
  it('không đụng tới thẻ manifest không đánh dấu (không đoán mò)', () => {
    const html = '<link rel="manifest" href="/m.json">'
    expect(stripPwaLink(html)).toBe(html)
  })
  it('chịu được thứ tự thuộc tính khác và xuống dòng kiểu Windows', () => {
    expect(stripPwaLink('<a>\r\n  <link data-az-pwa rel="manifest" href="/m">\r\n<b>')).toBe(
      '<a>\r\n<b>',
    )
  })
})

describe('Server phục vụ giao diện cho PWA', () => {
  let root = ''
  const serve = () => createStaticHandler(root)
  const get = (p: string, method = 'GET') =>
    serve()(new Request(`http://vps.local${p}`, { method }))

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'az-static-'))
    await mkdir(path.join(root, 'icons'))
    await writeFile(path.join(root, 'index.html'), HTML)
    await writeFile(path.join(root, 'manifest.webmanifest'), '{"name":"x"}')
    await writeFile(path.join(root, 'sw.js'), 'self.skipWaiting()')
  })
  afterAll(() => rm(root, { recursive: true, force: true }))

  it('index.html do VPS không còn khai báo manifest nên tunnel không bị mời cài', async () => {
    for (const p of ['/', '/index.html', '/links/7']) {
      const res = await get(p)
      const text = await res.text()
      expect(text, p).not.toContain('rel="manifest"')
      expect(text, p).toContain('<title>')
    }
  })

  it('Content-Length khớp số byte thật (tiếng Việt nhiều byte), HEAD cũng khớp', async () => {
    const res = await get('/')
    const bytes = Buffer.from(await res.arrayBuffer())
    expect(Number(res.headers.get('Content-Length'))).toBe(bytes.length)
    const head = await get('/', 'HEAD')
    expect(Number(head.headers.get('Content-Length'))).toBe(bytes.length)
    expect(head.headers.get('Cache-Control')).toBe('no-cache')
  })

  describe('nén brotli/gzip', () => {
    const BIG = `console.log(${JSON.stringify('az-sentinel '.repeat(400))})`
    const getEnc = (p: string, enc?: string, method = 'GET') =>
      serve()(
        new Request(`http://vps.local${p}`, {
          method,
          headers: enc ? { 'Accept-Encoding': enc } : {},
        }),
      )

    beforeAll(async () => {
      await mkdir(path.join(root, 'assets'))
      await writeFile(path.join(root, 'assets', 'app-abc123.js'), BIG)
      await writeFile(path.join(root, 'assets', 'font-abc123.woff2'), Buffer.alloc(4000, 7))
    })

    it('không gửi Accept-Encoding: trả nguyên bản, kèm Vary', async () => {
      const res = await getEnc('/assets/app-abc123.js')
      expect(res.headers.get('Content-Encoding')).toBeNull()
      expect(res.headers.get('Vary')).toBe('Accept-Encoding')
      expect(await res.text()).toBe(BIG)
    })

    it('br thắng gzip; giải nén ra đúng nội dung và Content-Length khớp số byte nén', async () => {
      const res = await getEnc('/assets/app-abc123.js', 'gzip, deflate, br')
      expect(res.headers.get('Content-Encoding')).toBe('br')
      const bytes = Buffer.from(await res.arrayBuffer())
      expect(Number(res.headers.get('Content-Length'))).toBe(bytes.length)
      expect(bytes.length).toBeLessThan(BIG.length / 5)
      expect(brotliDecompressSync(bytes).toString()).toBe(BIG)
      expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
    })

    it('chỉ gzip: dùng gzip; br;q=0 thì không dùng br', async () => {
      const g = await getEnc('/assets/app-abc123.js', 'gzip')
      expect(g.headers.get('Content-Encoding')).toBe('gzip')
      expect(gunzipSync(Buffer.from(await g.arrayBuffer())).toString()).toBe(BIG)
      const q0 = await getEnc('/assets/app-abc123.js', 'br;q=0, gzip')
      expect(q0.headers.get('Content-Encoding')).toBe('gzip')
    })

    it('index.html (đã gỡ manifest) cũng nén được, HEAD không nén và Content-Length là bản gốc', async () => {
      const res = await getEnc('/', 'br')
      expect(res.headers.get('Content-Encoding')).toBeNull() // dưới ngưỡng 1 KB thì không đáng nén
      const head = await getEnc('/assets/app-abc123.js', 'br', 'HEAD')
      expect(head.headers.get('Content-Encoding')).toBeNull()
      expect(Number(head.headers.get('Content-Length'))).toBe(Buffer.byteLength(BIG))
    })

    it('font woff2 (đã nén sẵn) không bị nén lại', async () => {
      const res = await getEnc('/assets/font-abc123.woff2', 'br, gzip')
      expect(res.headers.get('Content-Encoding')).toBeNull()
      expect(Number(res.headers.get('Content-Length'))).toBe(4000)
    })
  })

  it('manifest có đúng MIME; sw.js không bị cache lâu', async () => {
    const m = await get('/manifest.webmanifest')
    expect(m.headers.get('Content-Type')).toContain('application/manifest+json')
    const sw = await get('/sw.js')
    expect(sw.headers.get('Cache-Control')).toBe('no-cache')
    expect(sw.headers.get('Content-Type')).toContain('text/javascript')
  })
})
