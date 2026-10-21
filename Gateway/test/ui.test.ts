import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { configFilePath, loadConfig, saveEditableConfig } from '../src/config'
import { Gateway } from '../src/gateway'
import { LocalServer, type UiHooks } from '../src/local-server'
import { createFileSink } from '../src/log'
import { EventQueue } from '../src/queue'
import { compareVersions } from '../src/update-check'

describe('compareVersions', () => {
  it('so sánh theo x.y.z, bỏ tiền tố v', () => {
    expect(compareVersions('0.2.0', '0.1.9')).toBeGreaterThan(0)
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('0.1.10', '0.1.9')).toBeGreaterThan(0)
    expect(compareVersions('0.1.0', '0.2.0')).toBeLessThan(0)
  })
})

describe('saveEditableConfig', () => {
  let dir: string
  let env: NodeJS.ProcessEnv
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'azgw-'))
    env = { AZ_GW_DATA: dir }
  })

  it('giữ khóa khác và giữ token cũ khi token rỗng', () => {
    writeFileSync(
      configFilePath(env),
      JSON.stringify({ port: 47801, cloudToken: 'old-token', logLevel: 'debug' }),
    )
    saveEditableConfig(
      { cloudUrl: 'wss://x.workers.dev/api/gw/ws', cloudToken: '', vps: 'VPS-1', idleFlushSec: 60 },
      env,
    )
    const saved = JSON.parse(readFileSync(configFilePath(env), 'utf8'))
    expect(saved).toMatchObject({
      port: 47801,
      cloudToken: 'old-token',
      logLevel: 'debug',
      vps: 'VPS-1',
      idleFlushSec: 60,
    })
    const cfg = loadConfig(env)
    expect(cfg.cloudUrl).toBe('wss://x.workers.dev/api/gw/ws')
    expect(cfg.port).toBe(47801)
  })

  it('đổi token khi có giá trị mới; file chưa tồn tại thì tạo mới', () => {
    saveEditableConfig({ cloudUrl: '', cloudToken: 'new', vps: 'A', idleFlushSec: 0 }, env)
    expect(JSON.parse(readFileSync(configFilePath(env), 'utf8')).cloudToken).toBe('new')
  })

  it('từ chối ghi đè file JSON hỏng', () => {
    writeFileSync(configFilePath(env), '{not json')
    expect(() =>
      saveEditableConfig({ cloudUrl: '', cloudToken: '', vps: 'A', idleFlushSec: 0 }, env),
    ).toThrow(/hỏng/)
  })
})

describe('createFileSink', () => {
  it('xoay vòng khi vượt maxBytes và giữ tối đa số tệp', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'azgw-log-'))
    const sink = createFileSink(dir, { maxBytes: 50, files: 3 })
    for (let i = 0; i < 20; i++) sink('info', `dòng số ${i} ${'x'.repeat(20)}`)
    const names = ['gateway.log', 'gateway.1.log', 'gateway.2.log']
    for (const n of names) expect(readFileSync(path.join(dir, n), 'utf8').length).toBeGreaterThan(0)
    expect(() => readFileSync(path.join(dir, 'gateway.3.log'))).toThrow()
  })
})

describe('API giao diện /v1/ui/*', () => {
  let local: LocalServer
  let saved: unknown = null
  let restarted = false
  let base = ''
  const hooks: UiHooks = {
    getConfig: () => ({ vps: 'VPS-T', cloudUrl: '', idleFlushSec: 5, tokenSet: true, port: 1 }),
    saveConfig: (c) => {
      saved = c
    },
    getUpdate: () => ({ latest: '9.9.9', url: 'https://example.test', available: true }),
    tailLog: () => 'a\nb',
    restart: () => {
      restarted = true
    },
  }

  beforeEach(async () => {
    saved = null
    restarted = false
    const gw = new Gateway({ queue: new EventQueue(null) })
    local = new LocalServer(gw, 0, undefined, hooks)
    await local.start()
    base = `http://127.0.0.1:${local.listeningPort}`
  })
  afterEach(async () => {
    await local.stop()
  })

  const post = (p: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(base + p, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  const good = { cloudUrl: 'wss://a.b/ws', cloudToken: '', vps: 'V', idleFlushSec: 10 }

  it('GET config không bao giờ có token', async () => {
    const j = (await (await fetch(`${base}/v1/ui/config`)).json()) as Record<string, unknown>
    expect(j.tokenSet).toBe(true)
    expect(JSON.stringify(j)).not.toContain('cloudToken')
  })

  it('POST config đòi header x-az-ui', async () => {
    expect((await post('/v1/ui/config', good)).status).toBe(403)
    expect(saved).toBeNull()
  })

  it('POST config từ Origin lạ bị chặn', async () => {
    const r = await post('/v1/ui/config', good, { 'x-az-ui': '1', origin: 'https://evil.test' })
    expect(r.status).toBe(403)
    expect(saved).toBeNull()
  })

  it('POST config hợp lệ được lưu; dữ liệu sai trả 400', async () => {
    expect((await post('/v1/ui/config', good, { 'x-az-ui': '1' })).status).toBe(200)
    expect(saved).toMatchObject({ vps: 'V', idleFlushSec: 10 })
    const bad = await post('/v1/ui/config', { ...good, cloudUrl: 'http://sai' }, { 'x-az-ui': '1' })
    expect(bad.status).toBe(400)
  })

  it('restart chỉ chạy khi có header, và trả lời trước khi thoát', async () => {
    expect((await post('/v1/ui/restart', {})).status).toBe(403)
    expect((await post('/v1/ui/restart', {}, { 'x-az-ui': '1' })).status).toBe(200)
    await new Promise((r) => setTimeout(r, 450))
    expect(restarted).toBe(true)
  })

  it('log và update', async () => {
    expect(await (await fetch(`${base}/v1/ui/log`)).text()).toBe('a\nb')
    expect(
      ((await (await fetch(`${base}/v1/ui/update`)).json()) as { latest: string }).latest,
    ).toBe('9.9.9')
  })

  it('không có hooks thì route /v1/ui/ là 404 (Gateway cũ không đổi)', async () => {
    const gw = new Gateway({ queue: new EventQueue(null) })
    const bare = new LocalServer(gw, 0)
    await bare.start()
    try {
      const r = await fetch(`http://127.0.0.1:${bare.listeningPort}/v1/ui/config`)
      expect(r.status).toBe(404)
    } finally {
      await bare.stop()
    }
  })
})
