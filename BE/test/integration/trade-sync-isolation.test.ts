import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import { applySync, LINK_COLS, readLinksAfter } from '../../src/services/sync-service'
import { resetDb, seedLink } from '../helpers'

beforeEach(resetDb)

const empty = {
  users: [],
  tokens: [],
  links: [],
  links_deleted: [],
  trades: [],
  trades_deleted: [],
  alert_settings: [],
  alert_states: [],
  notifications: [],
}

const flag = async (id: number) =>
  (
    await env.DB.prepare('SELECT trade_enabled AS f FROM ea_links WHERE id = ?')
      .bind(id)
      .first<{ f: number }>()
  )?.f

describe('trade_enabled không đi theo đồng bộ VPS <-> Cloudflare (migration 0010)', () => {
  it('LINK_COLS không chứa trade_enabled', () => {
    expect(LINK_COLS as readonly string[]).not.toContain('trade_enabled')
  })

  it('liên kết mới mặc định tắt giao dịch từ xa', async () => {
    const { id } = await seedLink()
    expect(await flag(id)).toBe(0)
  })

  it('đẩy đồng bộ lên liên kết đang bật KHÔNG ghi đè cờ', async () => {
    const { id } = await seedLink()
    await env.DB.prepare('UPDATE ea_links SET trade_enabled = 1 WHERE id = ?').bind(id).run()
    const row = await env.DB.prepare(`SELECT ${LINK_COLS.join(', ')} FROM ea_links WHERE id = ?`)
      .bind(id)
      .first<Record<string, unknown>>()
    expect(row).not.toBeNull()
    await applySync(env.DB, {
      ...empty,
      // biome-ignore lint/suspicious/noExplicitAny: dòng đọc thẳng từ D1 cho test
      links: [{ ...(row as any), name: 'Đổi tên từ VPS' }],
    })
    expect(await flag(id)).toBe(1)
  })

  it('dòng đồng bộ đọc ra không mang trade_enabled', async () => {
    const { id } = await seedLink()
    await env.DB.prepare('UPDATE ea_links SET trade_enabled = 1 WHERE id = ?').bind(id).run()
    const { links } = await readLinksAfter(env.DB, 0, 10)
    expect(links.length).toBeGreaterThan(0)
    for (const r of links) expect(Object.keys(r)).not.toContain('trade_enabled')
  })

  it('trade_log: cmd_id là duy nhất; op và status ngoài danh sách bị CHECK chặn', async () => {
    const { id } = await seedLink()
    const ins = (cmd: string, op = 'close', status = 'sent') =>
      env.DB.prepare(
        `INSERT INTO trade_log (link_id, cmd_id, op, ticket, status, created_at) VALUES (?, ?, ?, 1, ?, 1)`,
      )
        .bind(id, cmd, op, status)
        .run()
    await ins('0123456789abcdef')
    await expect(ins('0123456789abcdef')).rejects.toThrow()
    await expect(ins('1123456789abcdef', 'buy')).rejects.toThrow()
    await expect(ins('2123456789abcdef', 'close', 'weird')).rejects.toThrow()
  })

  it('xóa liên kết vẫn giữ nhật ký giao dịch (không có khóa ngoại)', async () => {
    const { id } = await seedLink()
    await env.DB.prepare(
      `INSERT INTO trade_log (link_id, cmd_id, op, ticket, status, created_at) VALUES (?, 'aaaaaaaaaaaaaaaa', 'close', 1, 'done', 1)`,
    )
      .bind(id)
      .run()
    await env.DB.prepare('DELETE FROM ea_links WHERE id = ?').bind(id).run()
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM trade_log').first<{ n: number }>()
    expect(n?.n).toBe(1)
  })
})
