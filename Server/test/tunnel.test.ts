import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cloudflaredAsset, extractTunnelUrl, QuickTunnel } from '../src/tunnel'

const noop = () => {}
const log = { debug: noop, info: noop, warn: noop, error: noop }

describe('extractTunnelUrl', () => {
  it('lấy địa chỉ trong khung log của cloudflared', () => {
    const text =
      '2026-10-23T10:00:00Z INF |  Your quick Tunnel has been created! Visit it at:  |\n' +
      '2026-10-23T10:00:00Z INF |  https://rapid-lake-demo-7.trycloudflare.com                |\n'
    expect(extractTunnelUrl(text)).toBe('https://rapid-lake-demo-7.trycloudflare.com')
  })

  it('bỏ qua api.trycloudflare.com (máy chủ cấp tunnel, không phải tunnel của mình)', () => {
    const text =
      'ERR failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": dial tcp'
    expect(extractTunnelUrl(text)).toBeNull()
    expect(extractTunnelUrl(`${text}\nhttps://abc-def.trycloudflare.com`)).toBe(
      'https://abc-def.trycloudflare.com',
    )
  })

  it('không có địa chỉ thì trả null và đổi về chữ thường', () => {
    expect(extractTunnelUrl('INF Registered tunnel connection')).toBeNull()
    expect(extractTunnelUrl('https://ABC-DEF.TryCloudflare.com')).toBe(
      'https://abc-def.trycloudflare.com',
    )
  })
})

describe('cloudflaredAsset', () => {
  it('chọn đúng tệp theo hệ điều hành, hệ lạ thì null', () => {
    expect(cloudflaredAsset('win32', 'x64')).toBe('cloudflared-windows-amd64.exe')
    expect(cloudflaredAsset('linux', 'x64')).toBe('cloudflared-linux-amd64')
    expect(cloudflaredAsset('freebsd', 'x64')).toBeNull()
  })
})

/** cloudflared giả: mỗi lần `spawn` tạo một tiến trình mà test điều khiển được. */
function fakeSpawn() {
  type Fake = EventEmitter & {
    stdout: PassThrough
    stderr: PassThrough
    kill: () => void
    killed: boolean
  }
  const procs: Fake[] = []
  const spawnFn = ((_cmd: string, _args: string[]) => {
    const proc = new EventEmitter() as Fake
    proc.stdout = new PassThrough()
    proc.stderr = new PassThrough()
    proc.killed = false
    proc.kill = () => {
      proc.killed = true
      proc.emit('exit', 0)
    }
    procs.push(proc)
    return proc
  }) as never
  return { spawnFn, procs }
}

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms))

describe('QuickTunnel', () => {
  const tunnels: QuickTunnel[] = []
  afterEach(() => {
    for (const t of tunnels.splice(0)) t.stop()
    vi.restoreAllMocks()
  })

  function make(extra: Partial<ConstructorParameters<typeof QuickTunnel>[0]> = {}) {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'az-tunnel-'))
    const sp = fakeSpawn()
    const changes: (string | null)[] = []
    const urlFile = path.join(dir, 'tunnel-url.txt')
    const t = new QuickTunnel({
      port: 8080,
      binPath: path.join(dir, 'cloudflared'),
      urlFile,
      log,
      onChange: (u) => changes.push(u),
      spawnFn: sp.spawnFn,
      ensureBin: async () => {},
      killStale: () => {},
      backoffMs: [5],
      healthEveryMs: 10,
      graceMs: 0,
      ...extra,
    })
    tunnels.push(t)
    return { t, sp, changes, urlFile }
  }

  it('đọc địa chỉ từ stderr, ghi tệp và báo onChange', async () => {
    const { t, sp, changes, urlFile } = make({ healthEveryMs: 100_000 })
    t.start()
    await tick()
    sp.procs[0]?.stderr.write('INF |  https://one-aaa.trycloudflare.com  |\n')
    await tick()
    expect(t.url()).toBe('https://one-aaa.trycloudflare.com')
    expect(changes).toEqual(['https://one-aaa.trycloudflare.com'])
    expect(readFileSync(urlFile, 'utf8').trim()).toBe('https://one-aaa.trycloudflare.com')
  })

  it('cloudflared thoát thì báo null, chạy lại và nhận địa chỉ MỚI', async () => {
    const { t, sp, changes, urlFile } = make({ healthEveryMs: 100_000 })
    t.start()
    await tick()
    sp.procs[0]?.stderr.write('https://one-aaa.trycloudflare.com\n')
    await tick()
    sp.procs[0]?.emit('exit', 1)
    await tick(60)
    expect(sp.procs).toHaveLength(2)
    expect(existsSync(urlFile)).toBe(false)
    sp.procs[1]?.stdout.write('https://two-bbb.trycloudflare.com\n')
    await tick()
    expect(t.url()).toBe('https://two-bbb.trycloudflare.com')
    expect(changes).toEqual([
      'https://one-aaa.trycloudflare.com',
      null,
      'https://two-bbb.trycloudflare.com',
    ])
  })

  it('địa chỉ không còn thông /api/health nhiều lần liền thì giết cloudflared để chạy lại', async () => {
    const fetchFn = vi.fn(async () => new Response('bad', { status: 502 }))
    const { t, sp } = make({ fetchFn: fetchFn as never, maxFails: 2 })
    t.start()
    await tick()
    sp.procs[0]?.stderr.write('https://dead-ccc.trycloudflare.com\n')
    await tick(120)
    expect(fetchFn).toHaveBeenCalledWith(
      'https://dead-ccc.trycloudflare.com/api/health',
      expect.anything(),
    )
    expect(sp.procs[0]?.killed).toBe(true)
    expect(sp.procs.length).toBeGreaterThanOrEqual(2)
  })

  it('tunnel khỏe thì không bị khởi động lại', async () => {
    const fetchFn = vi.fn(async () => new Response('{"status":"ok"}'))
    const { t, sp } = make({ fetchFn: fetchFn as never, maxFails: 2 })
    t.start()
    await tick()
    sp.procs[0]?.stderr.write('https://ok-ddd.trycloudflare.com\n')
    await tick(120)
    expect(fetchFn).toHaveBeenCalled()
    expect(sp.procs).toHaveLength(1)
    expect(sp.procs[0]?.killed).toBe(false)
  })

  it('dọn cloudflared sót đúng một lần khi bắt đầu, trước khi chạy tiến trình mới', async () => {
    const killStale = vi.fn()
    const { t, sp } = make({ killStale, healthEveryMs: 100_000 })
    t.start()
    await tick()
    sp.procs[0]?.emit('exit', 1)
    await tick(60)
    expect(sp.procs.length).toBeGreaterThanOrEqual(2)
    expect(killStale).toHaveBeenCalledTimes(1)
    expect(killStale.mock.calls[0]?.[0]).toMatch(/cloudflared$/)
  })

  it('stop() dừng tiến trình và không chạy lại nữa', async () => {
    const { t, sp } = make({ healthEveryMs: 100_000 })
    t.start()
    await tick()
    t.stop()
    await tick(60)
    expect(sp.procs[0]?.killed).toBe(true)
    expect(sp.procs).toHaveLength(1)
  })
})
