import { env } from 'cloudflare:workers'
import type { SyncTokenRow } from '@az-sentinel/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app'
import {
  findActiveTokenByHash,
  getTokenById,
  listTokens,
} from '../../src/services/gw-token-service'
import { count, resetDb } from '../helpers'

const app = createApp()
const SYNC = 'sync-token-0123456789'
const baseEnv = { DB: env.DB, LIVE_HUB: env.LIVE_HUB, SYNC_TOKEN: SYNC }
const auth = { Authorization: `Bearer ${SYNC}`, 'Content-Type': 'application/json' }
const hex = (c: string) => c.repeat(64)

const row = (over: Partial<SyncTokenRow> = {}): SyncTokenRow => ({
  id: 1,
  owner_id: 7,
  label: 'An',
  token_hash: hex('a'),
  token_prefix: 'azt_AbCd1234',
  status: 'active',
  created_at: 100,
  revoked_at: null,
  ...over,
})

const apply = (tokens: SyncTokenRow[], headers: Record<string, string> = auth) =>
  app.fetch(
    new Request('http://az.test/api/sync/apply', {
      method: 'POST',
      headers,
      body: JSON.stringify({ tokens }),
    }),
    baseEnv,
  )

beforeEach(resetDb)

describe('đồng bộ token VPS -> Cloudflare (Plan 4)', () => {
  it('cần SYNC_TOKEN đúng', async () => {
    expect((await apply([row()], { 'Content-Type': 'application/json' })).status).toBe(401)
    expect(await count('gw_tokens')).toBe(0)
  })

  it('upsert: token mới tra được; gửi lại không nhân đôi', async () => {
    expect((await apply([row()])).status).toBe(200)
    expect((await apply([row()])).status).toBe(200)
    expect(await count('gw_tokens')).toBe(1)
    expect(await findActiveTokenByHash(env.DB, hex('a'))).toMatchObject({ owner_id: 7 })
  })

  it('không ghi đè last_used_at của Cloudflare', async () => {
    await apply([row()])
    await env.DB.prepare('UPDATE gw_tokens SET last_used_at = 555 WHERE id = 1').run()
    await apply([row({ label: 'An đổi tên' })])
    expect(await getTokenById(env.DB, 1)).toMatchObject({ label: 'An đổi tên', last_used_at: 555 })
  })

  it('đặt lại ở VPS (cùng id, băm mới): băm cũ hết hiệu lực', async () => {
    await apply([row()])
    await apply([row({ token_hash: hex('b') })])
    expect(await findActiveTokenByHash(env.DB, hex('a'))).toBeNull()
    expect(await findActiveTokenByHash(env.DB, hex('b'))).not.toBeNull()
  })

  it('thu hồi ở VPS: token không còn dùng được ở Cloudflare', async () => {
    await apply([row()])
    await apply([row({ status: 'revoked', revoked_at: 200 })])
    expect(await findActiveTokenByHash(env.DB, hex('a'))).toBeNull()
    expect(await getTokenById(env.DB, 1)).toMatchObject({ status: 'revoked', revoked_at: 200 })
  })

  it('cấp lại cho cùng người (id mới): token cũ còn active bị thu hồi, không vướng ràng buộc', async () => {
    await apply([row()])
    expect((await apply([row({ id: 2, token_hash: hex('c'), created_at: 300 })])).status).toBe(200)
    const rows = await listTokens(env.DB)
    expect(rows.filter((r) => r.status === 'active').map((r) => r.id)).toEqual([2])
    expect(await getTokenById(env.DB, 1)).toMatchObject({ status: 'revoked' })
  })

  it('dữ liệu sai hình dạng bị từ chối 400', async () => {
    expect((await apply([row({ token_hash: 'ngan' })])).status).toBe(400)
    expect((await apply([row({ owner_id: 0 })])).status).toBe(400)
  })

  it('GET /api/sync/tokens: phân trang theo id, không lộ cột last_used_at', async () => {
    await apply([
      row(),
      row({ id: 2, owner_id: 8, token_hash: hex('b') }),
      row({ id: 3, owner_id: 9, token_hash: hex('c') }),
    ])
    const get = (q: string) =>
      app.fetch(new Request(`http://az.test/api/sync/tokens?${q}`, { headers: auth }), baseEnv)
    const p1 = await (await get('after=0&limit=2')).json<{
      tokens: SyncTokenRow[]
      next: number | null
    }>()
    expect(p1.tokens.map((t) => t.id)).toEqual([1, 2])
    expect(p1.next).toBe(2)
    expect(p1.tokens[0]).not.toHaveProperty('last_used_at')
    const p2 = await (await get('after=2&limit=2')).json<{
      tokens: SyncTokenRow[]
      next: number | null
    }>()
    expect(p2.tokens.map((t) => t.id)).toEqual([3])
    expect(p2.next).toBeNull()
    const noAuth = await app.fetch(new Request('http://az.test/api/sync/tokens'), baseEnv)
    expect(noAuth.status).toBe(401)
  })
})
