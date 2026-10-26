import { RELEASES_PAGE_URL } from '@az-sentinel/shared'
import { describe, expect, it } from 'vitest'
import { fetchUpdate } from '../src/update-check'

const rel = (tag: string) => ({
  tag_name: tag,
  html_url: `${RELEASES_PAGE_URL}/tag/${tag}`,
  draft: false,
  prerelease: false,
})

function fake(res: () => Response) {
  const seen: Array<{ url: string; ifNoneMatch: string | null; ua: string | null }> = []
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const h = new Headers(init?.headers)
    seen.push({ url: String(input), ifNoneMatch: h.get('if-none-match'), ua: h.get('user-agent') })
    return res()
  }) as typeof fetch
  return { fetchImpl, seen }
}

describe('fetchUpdate (Gateway)', () => {
  it('chọn bản gateway-v mới nhất dù danh sách trộn nhiều bản server-v', async () => {
    // 30 bản server-v đứng trước: giới hạn 20 bản cũ sẽ làm mất bản Gateway.
    const list = [
      ...Array.from({ length: 30 }, (_, i) => rel(`server-v0.2.${i}`)),
      rel('gateway-v0.3.2'),
      rel('gateway-v0.4.0'),
    ]
    const { fetchImpl, seen } = fake(() => Response.json(list, { headers: { etag: '"abc"' } }))
    const out = await fetchUpdate('0.3.2', { fetchImpl })
    expect(out).toEqual({
      kind: 'updated',
      etag: '"abc"',
      info: { latest: '0.4.0', url: `${RELEASES_PAGE_URL}/tag/gateway-v0.4.0`, available: true },
    })
    expect(seen[0]?.url).toContain('per_page=100')
    expect(seen[0]?.ua).toBe('az-gateway/0.3.2')
  })

  it('gửi ETag cũ; 304 là unchanged', async () => {
    const { fetchImpl, seen } = fake(() => new Response(null, { status: 304 }))
    expect(await fetchUpdate('0.3.2', { etag: '"abc"', fetchImpl })).toEqual({ kind: 'unchanged' })
    expect(seen[0]?.ifNoneMatch).toBe('"abc"')
  })

  it('đang chạy bản mới nhất: available false', async () => {
    const { fetchImpl } = fake(() => Response.json([rel('gateway-v0.3.2')]))
    const out = await fetchUpdate('0.3.2', { fetchImpl })
    expect(out.kind === 'updated' && out.info?.available).toBe(false)
  })

  it('hết hạn mức (403/429) báo fullCycle; lỗi khác thì không', async () => {
    for (const code of [403, 429]) {
      const { fetchImpl } = fake(() => new Response('{}', { status: code }))
      expect(await fetchUpdate('0.3.2', { fetchImpl })).toMatchObject({
        kind: 'failed',
        fullCycle: true,
      })
    }
    const { fetchImpl } = fake(() => new Response('{}', { status: 502 }))
    expect(await fetchUpdate('0.3.2', { fetchImpl })).toMatchObject({
      kind: 'failed',
      fullCycle: false,
    })
  })

  it('mất mạng: failed kèm lý do (không ném lỗi)', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed')
    }) as typeof fetch
    expect(await fetchUpdate('0.3.2', { fetchImpl })).toEqual({
      kind: 'failed',
      reason: 'fetch failed',
      fullCycle: false,
    })
  })
})
