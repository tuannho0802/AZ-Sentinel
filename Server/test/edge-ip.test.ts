import type { AddressInfo } from 'node:net'
import { EDGE_IP_HEADER, EDGE_SIG_HEADER, EDGE_TS_HEADER } from '@az-sentinel/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { applyEdgeClientIp } from '../../BE/src/edge/edge-sign'
import { verifyEdgeClientIp } from '../src/edge-ip'
import { startHttpServer } from '../src/http'
import type { IpGuard } from '../src/ip-guard'

const SECRET = 'sync-token-0123456789-abcdefghijkl'
const NOW = 1_800_000_000

/** Header do Worker thật (BE) ký, để chắc phần ký (WebCrypto) và phần kiểm (node:crypto) khớp nhau. */
async function signed(ip: string, ts = NOW, secret = SECRET) {
  const h = new Headers()
  await applyEdgeClientIp(h, ip, secret, ts)
  return Object.fromEntries(h.entries())
}

describe('verifyEdgeClientIp', () => {
  it('chữ ký của Worker hợp lệ thì trả IP thật', async () => {
    expect(verifyEdgeClientIp(SECRET, await signed('203.0.113.9'), NOW)).toBe('203.0.113.9')
    expect(verifyEdgeClientIp(SECRET, await signed('2001:db8::1'), NOW + 60)).toBe('2001:db8::1')
  })

  it('sai khóa, sửa IP, hết hạn, thiếu header đều bị bỏ qua', async () => {
    const good = await signed('203.0.113.9')
    expect(verifyEdgeClientIp('khoa-khac-khoa-khac-khoa-khac-12', good, NOW)).toBeNull()
    expect(
      verifyEdgeClientIp(SECRET, { ...good, 'x-az-client-ip': '198.51.100.1' }, NOW),
    ).toBeNull()
    expect(verifyEdgeClientIp(SECRET, good, NOW + 301)).toBeNull()
    expect(verifyEdgeClientIp(SECRET, good, NOW - 301)).toBeNull()
    expect(verifyEdgeClientIp(SECRET, { 'x-az-client-ip': '203.0.113.9' }, NOW)).toBeNull()
    expect(verifyEdgeClientIp(SECRET, { ...good, 'x-az-edge-sig': 'zz' }, NOW)).toBeNull()
  })

  it('chưa có SYNC_TOKEN thì không tin header nào', async () => {
    expect(verifyEdgeClientIp('', await signed('203.0.113.9', NOW, ''), NOW)).toBeNull()
  })
})

describe('máy chủ HTTP + whitelist qua Worker (Plan 3G)', () => {
  const servers: ReturnType<typeof startHttpServer>[] = []
  afterEach(() => {
    for (const s of servers.splice(0)) s.close()
  })

  /** Whitelist giả: chỉ cho `allowed`, ghi lại IP đã bị chặn. */
  function boot(allowed: string[]) {
    const blocked: string[] = []
    const seen: Record<string, string | null> = {}
    const guard = {
      decide: (ip: string) =>
        allowed.includes(ip) ? { allow: true, maxConns: 5 } : { allow: false, reason: 'ip' },
      noteBlocked: (ip: string) => blocked.push(ip),
      describeBlock: (ip: string) => `IP ${ip} chưa được cho phép truy cập máy chủ này.`,
      acquire: () => () => {},
    } as unknown as IpGuard
    const server = startHttpServer({
      port: 0,
      host: '127.0.0.1',
      guard,
      edgeSecret: SECRET,
      handler: (req) => {
        seen.ip = req.headers.get('cf-connecting-ip')
        seen.edgeIp = req.headers.get(EDGE_IP_HEADER)
        seen.sig = req.headers.get(EDGE_SIG_HEADER)
        seen.ts = req.headers.get(EDGE_TS_HEADER)
        return Response.json({ ok: true })
      },
    })
    servers.push(server)
    return new Promise<{ url: string; blocked: string[]; seen: typeof seen }>((resolve) =>
      server.on('listening', () =>
        resolve({
          url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
          blocked,
          seen,
        }),
      ),
    )
  }

  it('IP thật có chữ ký nằm trong whitelist thì vào được, BE thấy IP thật, header ký bị gỡ', async () => {
    const { url, seen, blocked } = await boot(['203.0.113.9'])
    const ts = Math.floor(Date.now() / 1000)
    const res = await fetch(`${url}/api/x`, { headers: await signed('203.0.113.9', ts) })
    expect(res.status).toBe(200)
    expect(seen.ip).toBe('203.0.113.9')
    expect(seen.edgeIp).toBeNull()
    expect(seen.sig).toBeNull()
    expect(seen.ts).toBeNull()
    expect(blocked).toEqual([])
  })

  it('IP thật có chữ ký nhưng không có trong whitelist thì 403 kèm đúng IP đó', async () => {
    const { url, blocked } = await boot(['203.0.113.9'])
    const ts = Math.floor(Date.now() / 1000)
    const res = await fetch(`${url}/api/x`, { headers: await signed('198.51.100.7', ts) })
    expect(res.status).toBe(403)
    expect(JSON.stringify(await res.json())).toContain('198.51.100.7')
    expect(blocked).toEqual(['198.51.100.7'])
  })

  it('client tự đặt X-AZ-Client-IP (không chữ ký) để mạo danh IP được phép thì vô hiệu', async () => {
    const { url, blocked } = await boot(['203.0.113.9'])
    const res = await fetch(`${url}/api/x`, { headers: { [EDGE_IP_HEADER]: '203.0.113.9' } })
    // Header giả bị bỏ qua: VPS xét theo IP socket thật (127.0.0.1), không phải IP được phép trong header.
    expect(res.status).toBe(403)
    expect(blocked).toEqual(['127.0.0.1'])
  })
})
