import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gatewayAssetUrl } from '@az-sentinel/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../src/config'
import { Gateway } from '../src/gateway'
import { silentLogger } from '../src/log'
import {
  OLD_EXE,
  SelfUpdater,
  type SelfUpdaterOptions,
  STAGED_EXE,
  STAGED_VER,
  TRIAL_FILE,
  UPDATE_FAILED_FILE,
} from '../src/self-update'

const NEW_VER = '0.4.0'
// Một "exe" giả: bắt đầu bằng MZ và đủ 1 KB.
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(2048, 7)])
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
const offer = (over: Partial<{ min_ver: string; url: string; sha256: string }> = {}) => ({
  min_ver: NEW_VER,
  url: gatewayAssetUrl(NEW_VER),
  sha256: sha(EXE),
  ...over,
})

function okFetch(body: Buffer = EXE, finalUrl?: string): typeof fetch {
  return (async () => {
    const res = new Response(new Uint8Array(body), { status: 200 })
    if (finalUrl) Object.defineProperty(res, 'url', { value: finalUrl })
    return res
  }) as typeof fetch
}

let appDir: string
let dataDir: string
let restart: ReturnType<typeof vi.fn>

function make(over: Partial<SelfUpdaterOptions> = {}) {
  return new SelfUpdater({
    current: '0.3.7',
    appDir,
    dataDir,
    supervised: true,
    log: silentLogger,
    restart,
    fetchFn: okFetch(),
    restartDelayMs: 1,
    ...over,
  })
}

const wait = (ms = 15) => new Promise((r) => setTimeout(r, ms))

beforeEach(() => {
  appDir = mkdtempSync(path.join(os.tmpdir(), 'az-gw-app-'))
  dataDir = mkdtempSync(path.join(os.tmpdir(), 'az-gw-data-'))
  restart = vi.fn()
})
afterEach(() => {
  rmSync(appDir, { recursive: true, force: true })
  rmSync(dataDir, { recursive: true, force: true })
})

describe('SelfUpdater: điều kiện bỏ qua', () => {
  it('không tự cập nhật khi chạy tay, không đóng gói hoặc người dùng tắt', async () => {
    expect(await make({ supervised: false }).offer(offer())).toBe('disabled')
    expect(await make({ appDir: null }).offer(offer())).toBe('disabled')
    expect(await make({ enabled: false }).offer(offer())).toBe('disabled')
    expect(await make({ current: '0.1.0-dev' }).offer(offer())).toBe('disabled')
    expect(existsSync(path.join(appDir, STAGED_EXE))).toBe(false)
    expect(restart).not.toHaveBeenCalled()
  })

  it('bản không mới hơn thì bỏ qua (không hạ cấp)', async () => {
    const u = make()
    expect(await u.offer(offer({ min_ver: '0.3.7', url: gatewayAssetUrl('0.3.7') }))).toBe(
      'not-newer',
    )
    expect(await u.offer(offer({ min_ver: '0.3.0', url: gatewayAssetUrl('0.3.0') }))).toBe(
      'not-newer',
    )
  })

  it('chỉ nhận đúng địa chỉ release của dự án và mã băm hợp lệ', async () => {
    const fetchFn = vi.fn(okFetch())
    const u = make({ fetchFn: fetchFn as unknown as typeof fetch })
    expect(await u.offer(offer({ url: 'https://evil.example/az-gateway.exe' }))).toBe('untrusted')
    expect(
      await u.offer(
        offer({
          url: 'https://github.com/someone/else/releases/download/gateway-v0.4.0/az-gateway.exe',
        }),
      ),
    ).toBe('untrusted')
    expect(await u.offer(offer({ url: gatewayAssetUrl('0.9.9') }))).toBe('untrusted')
    expect(await u.offer(offer({ sha256: 'xyz' }))).toBe('untrusted')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('bản từng khởi động lỗi và bị trả về thì không nhận lại', async () => {
    writeFileSync(path.join(dataDir, UPDATE_FAILED_FILE), `${NEW_VER}\r\n`)
    const fetchFn = vi.fn(okFetch())
    const u = make({ fetchFn: fetchFn as unknown as typeof fetch })
    expect(await u.offer(offer())).toBe('blocked')
    // Bản mới hơn bản lỗi thì vẫn được nhận.
    expect(await u.offer(offer({ min_ver: '0.4.1', url: gatewayAssetUrl('0.4.1') }))).toBe('staged')
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })
})

describe('SelfUpdater: tải và đặt chỗ chờ', () => {
  it('tải đúng băm: ghi .new và nhãn phiên bản rồi yêu cầu khởi động lại', async () => {
    const u = make()
    expect(await u.offer(offer())).toBe('staged')
    expect(readFileSync(path.join(appDir, STAGED_EXE))).toEqual(EXE)
    expect(readFileSync(path.join(appDir, STAGED_VER), 'utf8').trim()).toBe(NEW_VER)
    expect(existsSync(path.join(appDir, `${STAGED_EXE}.part`))).toBe(false)
    await wait()
    expect(restart).toHaveBeenCalledTimes(1)
  })

  it('khởi động lại đúng một lần dù Server nhắc nhiều lần', async () => {
    const u = make()
    await u.offer(offer())
    expect(await u.offer(offer())).toBe('busy')
    await wait()
    expect(restart).toHaveBeenCalledTimes(1)
  })

  it('đã có bản chờ đúng phiên bản thì không tải lại', async () => {
    writeFileSync(path.join(appDir, STAGED_EXE), EXE)
    writeFileSync(path.join(appDir, STAGED_VER), `${NEW_VER}\n`)
    const fetchFn = vi.fn(okFetch())
    const u = make({ fetchFn: fetchFn as unknown as typeof fetch })
    expect(await u.offer(offer())).toBe('staged')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('mã băm sai: xóa file tải, không để lại .new, không khởi động lại', async () => {
    const u = make()
    expect(await u.offer(offer({ sha256: 'f'.repeat(64) }))).toBe('failed')
    expect(existsSync(path.join(appDir, STAGED_EXE))).toBe(false)
    expect(existsSync(path.join(appDir, `${STAGED_EXE}.part`))).toBe(false)
    await wait()
    expect(restart).not.toHaveBeenCalled()
  })

  it('file không phải exe Windows (không có MZ) thì bị từ chối dù băm khớp', async () => {
    const junk = Buffer.alloc(4096, 1)
    const u = make({ fetchFn: okFetch(junk) })
    expect(await u.offer(offer({ sha256: sha(junk) }))).toBe('failed')
    expect(existsSync(path.join(appDir, STAGED_EXE))).toBe(false)
  })

  it('bị chuyển hướng sang host lạ thì từ chối', async () => {
    const u = make({ fetchFn: okFetch(EXE, 'https://evil.example/az-gateway.exe') })
    expect(await u.offer(offer())).toBe('failed')
    expect(existsSync(path.join(appDir, STAGED_EXE))).toBe(false)
  })

  it('chấp nhận chuyển hướng sang kho file của GitHub', async () => {
    const u = make({
      fetchFn: okFetch(EXE, 'https://release-assets.githubusercontent.com/github-production/x'),
    })
    expect(await u.offer(offer())).toBe('staged')
  })

  it('HTTP lỗi thì giữ bản đang chạy và chờ một lúc mới thử lại cùng phiên bản', async () => {
    let calls = 0
    const bad = (async () => {
      calls++
      return new Response('no', { status: 404 })
    }) as typeof fetch
    let t = 1_000
    const u = make({ fetchFn: bad, now: () => t, retryAfterMs: 60_000 })
    expect(await u.offer(offer())).toBe('failed')
    expect(await u.offer(offer())).toBe('cooldown')
    expect(calls).toBe(1)
    t += 61_000
    expect(await u.offer(offer())).toBe('failed')
    expect(calls).toBe(2)
    expect(restart).not.toHaveBeenCalled()
  })
})

describe('SelfUpdater.markHealthy', () => {
  it('xóa bản cũ, cờ thử nghiệm và file tải dở', () => {
    for (const f of [OLD_EXE, TRIAL_FILE, `${STAGED_EXE}.part`]) {
      writeFileSync(path.join(appDir, f), 'x')
    }
    make().markHealthy()
    for (const f of [OLD_EXE, TRIAL_FILE, `${STAGED_EXE}.part`]) {
      expect(existsSync(path.join(appDir, f))).toBe(false)
    }
  })

  it('quên bản từng lỗi khi đã chạy bản mới hơn hẳn', () => {
    const file = path.join(dataDir, UPDATE_FAILED_FILE)
    writeFileSync(file, '0.3.9\n')
    make({ current: '0.3.7' }).markHealthy()
    expect(existsSync(file)).toBe(true)
    make({ current: '0.4.0' }).markHealthy()
    expect(existsSync(file)).toBe(false)
  })
})

describe('Gateway chuyển tin update cho bộ tự cập nhật', () => {
  it('gọi onUpdate với đúng nội dung; không có onUpdate thì không ném lỗi', () => {
    const onUpdate = vi.fn()
    const gw = new Gateway({ onUpdate })
    const msg = {
      t: 'update' as const,
      min_ver: NEW_VER,
      url: gatewayAssetUrl(NEW_VER),
      sha256: sha(EXE),
    }
    gw.onCloudMessage(msg)
    expect(onUpdate).toHaveBeenCalledWith(msg)
    expect(() => new Gateway().onCloudMessage(msg)).not.toThrow()
  })
})

describe('cấu hình autoUpdate', () => {
  it('mặc định bật; AZ_GW_AUTO_UPDATE=0 tắt', () => {
    const env = { AZ_GW_DATA: dataDir, AZ_GW_CONFIG: path.join(dataDir, 'none.json') }
    expect(loadConfig(env).autoUpdate).toBe(true)
    expect(loadConfig({ ...env, AZ_GW_AUTO_UPDATE: '0' }).autoUpdate).toBe(false)
    expect(loadConfig({ ...env, AZ_GW_AUTO_UPDATE: 'false' }).autoUpdate).toBe(false)
    expect(loadConfig({ ...env, AZ_GW_AUTO_UPDATE: '1' }).autoUpdate).toBe(true)
  })

  it('đọc autoUpdate: false từ config.json', () => {
    const file = path.join(dataDir, 'config.json')
    writeFileSync(file, JSON.stringify({ autoUpdate: false }))
    expect(loadConfig({ AZ_GW_DATA: dataDir, AZ_GW_CONFIG: file }).autoUpdate).toBe(false)
  })
})
