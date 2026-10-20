import { env, exports } from 'cloudflare:workers'
import type { IngestPayload } from '@az-sentinel/shared'
import { generateApiKey } from '../src/lib/crypto'

export const SERVER = 'Broker-Live01'
export const LOGIN = 12345678

export async function resetDb(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM events'),
    env.DB.prepare('DELETE FROM trades'),
    env.DB.prepare('DELETE FROM equity_m5'),
    env.DB.prepare('DELETE FROM link_state'),
    env.DB.prepare('DELETE FROM ea_links'),
  ])
}

type SeedOptions = { status?: 'active' | 'disabled'; bound?: boolean; login?: number }

/** Tạo liên kết; mặc định đã gắn với (SERVER, LOGIN). bound=false để thử lần gắn đầu tiên. */
export async function seedLink(opts: SeedOptions = {}) {
  const { key, keyHash, keyPrefix } = await generateApiKey()
  const bound = opts.bound ?? true
  const row = await env.DB.prepare(
    `INSERT INTO ea_links (login, server, key_hash, key_prefix, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(
      bound ? (opts.login ?? LOGIN) : null,
      bound ? SERVER : null,
      keyHash,
      keyPrefix,
      opts.status ?? 'active',
      1,
    )
    .first<{ id: number }>()
  if (!row) throw new Error('seed thất bại')
  return { id: row.id, key }
}

let counter = 0

/** Payload hợp lệ; mỗi lần gọi có seq tăng dần trong cùng sid. */
export function makePayload(overrides: Record<string, unknown> = {}): IngestPayload {
  counter += 1
  return {
    v: 1,
    sid: 'sess01',
    seq: counter,
    reason: ['heartbeat'],
    ts_utc: Math.floor(Date.now() / 1000),
    vps: 'vps-a12',
    ea_ver: '0.1.0',
    account: {
      login: LOGIN,
      server: SERVER,
      broker: 'Broker Ltd',
      name: 'Nguyen Van A',
      currency: 'USD',
      balance: 10000,
      equity: 10050.5,
      floating_pl: 50.5,
      margin_level: null,
    },
    positions: [],
    events: [],
    ...overrides,
  } as IngestPayload
}

export function post(key: string | null, body: unknown, extraHeaders: Record<string, string> = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extraHeaders }
  if (key !== null) headers['X-API-Key'] = key
  return exports.default.fetch(
    new Request('http://az.test/api/ea/v1/ingest', {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )
}

export async function count(table: string, where = '1=1'): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).first<{
    n: number
  }>()
  return row?.n ?? 0
}

export function tradeEvent(over: Record<string, unknown>) {
  return {
    kind: 'open',
    deal_ticket: 1,
    position_id: 5001,
    symbol: 'XAUUSD',
    type: 'buy',
    volume: 0.1,
    time: 1792499000,
    price: 4010.12,
    ...over,
  }
}
