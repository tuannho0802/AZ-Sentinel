import { RELEASES_PAGE_URL, type ServerNode, serverInfoSchema } from '@az-sentinel/shared'
import type { Context } from 'hono'
import { describe, expect, it } from 'vitest'
import { buildServerInfo } from '../../BE/src/services/server-info-service'
import type { AppEnv, HostHooks } from '../../BE/src/types'
import type { ServerConfig } from '../src/config'
import { createHostHooks, describeNode } from '../src/host'

const node: ServerNode = {
  role: 'vps',
  name: 'VPS',
  host: null,
  os: null,
  arch: 'x64',
  runtime: 'node v22',
  version: '0.2.3',
  startedAt: 1,
  uptimeSec: 1,
  cpuCount: 2,
  memTotalMb: 1,
  memFreeMb: 1,
  cpuPct: null,
  location: null,
}

/** Context tối thiểu: nhánh VPS của `buildServerInfo` chỉ đọc `c.env.HOST`. */
const ctx = (host: HostHooks) =>
  ({ env: { HOST: host }, req: { raw: {} } }) as unknown as Context<AppEnv>

const base: HostHooks = {
  role: 'vps',
  describe: () => node,
  standby: () => null,
  fallbackUrl: null,
}

describe('GET /api/server-info trên VPS mang thông tin bản cập nhật', () => {
  it('VPS có kiểm tra: trả `update` đúng schema để giao diện hiện banner', async () => {
    const update = {
      server: { latest: '0.3.0', url: `${RELEASES_PAGE_URL}/tag/server-v0.3.0`, available: true },
      checkedAt: 1_700_000_000,
    }
    const info = await buildServerInfo(ctx({ ...base, updates: () => update }))
    expect(info.mode).toBe('primary')
    expect(info.update).toEqual(update)
    expect(serverInfoSchema.safeParse(info).success).toBe(true)
  })

  it('VPS không kiểm tra (dev hoặc AZ_UPDATE_CHECK=0): update là null, không có banner', async () => {
    const info = await buildServerInfo(ctx(base))
    expect(info.update).toBeNull()
    expect(serverInfoSchema.safeParse(info).success).toBe(true)
  })
})

describe('createHostHooks / describeNode', () => {
  const cfg = { name: 'VPS-A', location: '', fallbackUrl: '' } as unknown as ServerConfig
  const cpu = { value: () => null } as unknown as Parameters<typeof describeNode>[1]

  it('chỉ gắn móc updates khi được truyền vào', () => {
    expect(createHostHooks(cfg, cpu, () => null).updates).toBeUndefined()
    const fn = () => null
    expect(createHostHooks(cfg, cpu, () => null, fn).updates).toBe(fn)
  })

  it('phiên bản Server lấy từ bản đóng gói (AZ_SERVER_VERSION), không phải số gán cứng 0.1.0', () => {
    const prev = process.env.AZ_SERVER_VERSION
    try {
      process.env.AZ_SERVER_VERSION = '0.2.3'
      expect(describeNode(cfg, cpu).version).toBe('0.2.3')
      delete process.env.AZ_SERVER_VERSION
      expect(describeNode(cfg, cpu).version).toBe('0.1.0')
    } finally {
      if (prev === undefined) delete process.env.AZ_SERVER_VERSION
      else process.env.AZ_SERVER_VERSION = prev
    }
  })
})
