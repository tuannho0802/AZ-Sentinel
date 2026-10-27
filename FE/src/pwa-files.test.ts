import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/** Kiểm các tệp tĩnh của PWA: sai một chỗ là trình duyệt âm thầm không cho cài. */
const pub = (f: string) => path.resolve(__dirname, '../public', f.replace(/^\//, ''))
const manifest = JSON.parse(readFileSync(pub('manifest.webmanifest'), 'utf8')) as {
  id: string
  name: string
  start_url: string
  scope: string
  display: string
  icons: { src: string; sizes: string; type: string; purpose: string }[]
}

function pngSize(file: string): { w: number; h: number } {
  const b = readFileSync(file)
  expect(b.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}

describe('manifest.webmanifest', () => {
  it('chạy dạng ứng dụng, bắt đầu và phạm vi ở gốc (Worker chuyển hướng gốc sang tunnel sống)', () => {
    expect(manifest.display).toBe('standalone')
    expect(manifest.start_url).toBe('/')
    expect(manifest.scope).toBe('/')
    expect(manifest.id).toBe('/')
    expect(manifest.name).toBe('AZ Sentinel')
  })

  it('start_url KHÔNG mang az_stay: mỗi lần mở ứng dụng phải đi tìm tunnel đang sống', () => {
    expect(manifest.start_url).not.toContain('az_stay')
  })

  it('có icon 192, 512 và 512 maskable, tệp thật và đúng kích thước khai báo', () => {
    const want = [
      ['192x192', 'any'],
      ['512x512', 'any'],
      ['512x512', 'maskable'],
    ]
    for (const [sizes, purpose] of want) {
      const icon = manifest.icons.find((i) => i.sizes === sizes && i.purpose === purpose)
      expect(icon, `${sizes} ${purpose}`).toBeTruthy()
      const { w, h } = pngSize(pub((icon as { src: string }).src))
      expect(`${w}x${h}`).toBe(sizes)
    }
  })
})

describe('sw.js', () => {
  const sw = readFileSync(pub('sw.js'), 'utf8')
  it('chỉ xử lý lượt mở trang, không đụng tới API/WebSocket', () => {
    // bỏ comment trước khi dò: chú thích có nhắc tới /api/ nhưng mã thì không được dính tới
    const code = sw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code).toContain("req.mode !== 'navigate'")
    expect(code).not.toMatch(/\/api\b|WebSocket|pathname/)
  })
  it('có trang offline và tệp đó tồn tại', () => {
    expect(sw).toContain('/offline.html')
    expect(readFileSync(pub('offline.html'), 'utf8')).toContain('Không có kết nối mạng')
  })
})

describe('index.html', () => {
  const html = readFileSync(path.resolve(__dirname, '../index.html'), 'utf8')
  it('khai báo manifest bằng thẻ có data-az-pwa để Server VPS gỡ được', () => {
    expect(html).toMatch(/<link rel="manifest" href="\/manifest\.webmanifest" data-az-pwa \/>/)
  })
})
