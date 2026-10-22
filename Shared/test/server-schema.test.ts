import { describe, expect, it } from 'vitest'
import {
  FAILOVER,
  serverInfoSchema,
  serverNodeSchema,
  syncApplySchema,
  syncLinkRowSchema,
  syncTradeRowSchema,
} from '../src'

const node = {
  role: 'vps',
  name: 'VPS-MAIN',
  host: 'WIN-ABC123',
  os: 'Windows Server 2022',
  arch: 'x64',
  runtime: 'node v22.22.2',
  version: '0.1.0',
  startedAt: 1_700_000_000,
  uptimeSec: 3600,
  cpuCount: 4,
  memTotalMb: 8192,
  memFreeMb: 4096,
  cpuPct: 12.5,
  location: null,
}

const link = {
  id: 1,
  owner_id: null,
  login: 123,
  server: 'Broker-Live01',
  broker: null,
  name: null,
  currency: 'USD',
  mode: 'real',
  key_hash: 'a'.repeat(64),
  key_prefix: 'abcd1234',
  status: 'active',
  bound_at: 10,
  created_at: 5,
  vps_name: null,
}

describe('server-schema', () => {
  it('chấp nhận node hợp lệ và từ chối vai trò lạ', () => {
    expect(serverNodeSchema.safeParse(node).success).toBe(true)
    expect(serverNodeSchema.safeParse({ ...node, role: 'aws' }).success).toBe(false)
  })

  it('cpuPct nằm trong 0..100', () => {
    expect(serverNodeSchema.safeParse({ ...node, cpuPct: 101 }).success).toBe(false)
    expect(serverNodeSchema.safeParse({ ...node, cpuPct: null }).success).toBe(true)
  })

  it('serverInfo: ghép đủ các phần', () => {
    const ok = serverInfoSchema.safeParse({
      mode: 'primary',
      active: node,
      primary: { configured: true, status: 'up', lastSeenAt: 1, info: node },
      standby: { configured: true, lastSyncAt: null, pending: 0, lastError: null },
      gateways: 2,
      viewers: 1,
      checkedAt: 2,
    })
    expect(ok.success).toBe(true)
  })

  it('sync: liên kết cần key_hash 64 hex và status hợp lệ', () => {
    expect(syncLinkRowSchema.safeParse(link).success).toBe(true)
    expect(syncLinkRowSchema.safeParse({ ...link, key_hash: 'xyz' }).success).toBe(false)
    expect(syncLinkRowSchema.safeParse({ ...link, status: 'deleted' }).success).toBe(false)
  })

  it('sync: lô rỗng có mặc định, quá 100 dòng bị từ chối', () => {
    expect(syncApplySchema.parse({})).toEqual({
      links: [],
      links_deleted: [],
      trades: [],
      trades_deleted: [],
    })
    const trade = syncTradeRowSchema.parse({
      link_id: 1,
      ticket: 9,
      symbol: 'XAUUSD',
      type: 'buy',
      volume: 0.1,
      open_time: 1,
      open_price: 2000,
      close_time: null,
      close_price: null,
      sl: null,
      tp: null,
      profit: null,
      swap: null,
      commission: null,
      comment: null,
      magic: null,
    })
    expect(syncApplySchema.safeParse({ trades: Array(101).fill(trade) }).success).toBe(false)
  })

  it('FAILOVER: dò dày hơn khi VPS đang sập để quay về sớm', () => {
    expect(FAILOVER.probeDownTtlMs).toBeLessThan(FAILOVER.probeOkTtlMs)
    expect(FAILOVER.probeTimeoutMs).toBeLessThan(FAILOVER.proxyTimeoutMs)
  })
})
