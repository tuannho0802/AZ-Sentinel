import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gatewayAssetUrl } from '@az-sentinel/shared'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { silentLogger } from '../src/log'
import {
  ATTEMPT_WINDOW_MS,
  MAX_RESTART_ATTEMPTS,
  SelfUpdater,
  type SelfUpdaterOptions,
  STAGED_EXE,
  STAGED_VER,
  UPDATE_ATTEMPT_FILE,
  UPDATE_FAILED_FILE,
} from '../src/self-update'

/**
 * Các ca LỖI của tự cập nhật Gateway: mạng đứt, tải cụt, file hỏng, đĩa không ghi được, vòng khởi động lại vô hạn...
 * Mục tiêu chung: không bao giờ ném lỗi ra ngoài, không để lại `.new` hỏng, luôn giữ bản đang chạy.
 */

const NEW_VER = '0.4.0'
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(2048, 7)])
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
const offer = (over: Partial<{ min_ver: string; url: string; sha256: string }> = {}) => ({
  min_ver: NEW_VER,
  url: gatewayAssetUrl(NEW_VER),
  sha256: sha(EXE),
  ...over,
})
const okFetch = (body: Buffer = EXE, headers: Record<string, string> = {}): typeof fetch =>
  (async () => new Response(new Uint8Array(body), { status: 200, headers })) as typeof fetch

let appDir: string
let dataDir: string
let restart: Mock<() => void>

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
const staged = () => path.join(appDir, STAGED_EXE)
const stagedVer = () => path.join(appDir, STAGED_VER)
const part = () => `${staged()}.part`
const noResidue = () => {
  expect(existsSync(staged()), '.new không được tồn tại').toBe(false)
  expect(existsSync(stagedVer()), '.new.ver không được tồn tại').toBe(false)
  expect(existsSync(part()), '.part không được tồn tại').toBe(false)
}

beforeEach(() => {
  appDir = mkdtempSync(path.join(os.tmpdir(), 'az-gw-app-'))
  dataDir = mkdtempSync(path.join(os.tmpdir(), 'az-gw-data-'))
  restart = vi.fn<() => void>()
})
afterEach(() => {
  rmSync(appDir, { recursive: true, force: true })
  rmSync(dataDir, { recursive: true, force: true })
})

describe('tải về lỗi: mạng và máy chủ', () => {
  it('mất mạng (fetch ném lỗi): failed, không để lại file, chờ một lúc mới thử lại', async () => {
    let calls = 0
    const down = (async () => {
      calls++
      throw new TypeError('fetch failed')
    }) as typeof fetch
    let t = 0
    const u = make({ fetchFn: down, now: () => t, retryAfterMs: 60_000 })
    expect(await u.offer(offer())).toBe('failed')
    expect(await u.offer(offer())).toBe('cooldown')
    expect(calls).toBe(1)
    noResidue()
    t += 60_001
    expect(await u.offer(offer())).toBe('failed')
    expect(calls).toBe(2)
    await wait()
    expect(restart).not.toHaveBeenCalled()
  })

  it('quá thời gian chờ (AbortError/TimeoutError) cũng chỉ là failed', async () => {
    const timeout = (async () => {
      throw new DOMException('The operation timed out', 'TimeoutError')
    }) as typeof fetch
    expect(await make({ fetchFn: timeout }).offer(offer())).toBe('failed')
    noResidue()
  })

  it.each([403, 404, 429, 500, 503])('HTTP %i: failed, không để lại file', async (code) => {
    const f = (async () => new Response('x', { status: code })) as typeof fetch
    expect(await make({ fetchFn: f }).offer(offer())).toBe('failed')
    noResidue()
  })

  it('HTTP 200 nhưng không có thân (body null): failed', async () => {
    const f = (async () => new Response(null, { status: 200 })) as typeof fetch
    expect(await make({ fetchFn: f }).offer(offer())).toBe('failed')
    noResidue()
  })

  it('đứt kết nối giữa chừng (tải cụt): xóa .part, không tạo .new, không khởi động lại', async () => {
    const truncated = (async () => {
      let sent = false
      const body = new ReadableStream<Uint8Array>({
        pull(c) {
          if (!sent) {
            sent = true
            c.enqueue(new Uint8Array(EXE.subarray(0, 100)))
            return
          }
          c.error(new Error('ECONNRESET'))
        },
      })
      return new Response(body, { status: 200 })
    }) as typeof fetch
    expect(await make({ fetchFn: truncated }).offer(offer())).toBe('failed')
    noResidue()
    await wait()
    expect(restart).not.toHaveBeenCalled()
  })

  it('chuyển hướng tới địa chỉ không phân tích được: failed', async () => {
    const f = (async () => {
      const res = new Response(new Uint8Array(EXE), { status: 200 })
      Object.defineProperty(res, 'url', { value: 'not a url' })
      return res
    }) as typeof fetch
    expect(await make({ fetchFn: f }).offer(offer())).toBe('failed')
    noResidue()
  })
})

describe('tải về lỗi: nội dung file', () => {
  it('Content-Length khai báo vượt trần: failed trước khi ghi gì', async () => {
    const u = make({ maxBytes: 1000, fetchFn: okFetch(EXE, { 'content-length': '2050' }) })
    expect(await u.offer(offer())).toBe('failed')
    noResidue()
  })

  it('không khai báo kích thước nhưng thân vượt trần: ngắt giữa chừng, xóa .part', async () => {
    const endless = (async () => {
      let n = 0
      const body = new ReadableStream<Uint8Array>({
        pull(c) {
          c.enqueue(new Uint8Array(1024))
          if (++n >= 50) c.close()
        },
      })
      return new Response(body, { status: 200 })
    }) as typeof fetch
    expect(await make({ maxBytes: 2500, fetchFn: endless }).offer(offer())).toBe('failed')
    noResidue()
  })

  it('file quá nhỏ (có MZ, băm khớp) vẫn bị từ chối', async () => {
    const tiny = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100, 1)])
    const u = make({ fetchFn: okFetch(tiny) })
    expect(await u.offer(offer({ sha256: sha(tiny) }))).toBe('failed')
    noResidue()
  })

  it('trang HTML lỗi của GitHub (HTTP 200, băm không khớp) không bao giờ thành .new', async () => {
    const html = Buffer.from(`<html>${'x'.repeat(3000)}</html>`)
    expect(await make({ fetchFn: okFetch(html) }).offer(offer())).toBe('failed')
    noResidue()
  })

  it('băm Server báo viết HOA bị coi là không hợp lệ (Gateway chỉ nhận chữ thường)', async () => {
    const fetchFn = vi.fn(okFetch())
    const u = make({ fetchFn: fetchFn as unknown as typeof fetch })
    expect(await u.offer(offer({ sha256: sha(EXE).toUpperCase() }))).toBe('untrusted')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it.each(['', 'abc', '1.2', '0.4.0-beta', '0.4.0.1'])(
    'min_ver %j không phải số phát hành x.y.z: bỏ qua, không tải',
    async (v) => {
      const fetchFn = vi.fn(okFetch())
      const u = make({ fetchFn: fetchFn as unknown as typeof fetch })
      expect(await u.offer(offer({ min_ver: v }))).toBe('not-newer')
      expect(fetchFn).not.toHaveBeenCalled()
    },
  )
})

describe('min_ver có tiền tố v', () => {
  it('địa chỉ không khớp gatewayAssetUrl nên bị từ chối, không tải', async () => {
    const fetchFn = vi.fn(okFetch())
    const u = make({ fetchFn: fetchFn as unknown as typeof fetch })
    expect(await u.offer(offer({ min_ver: 'v0.4.0' }))).toBe('untrusted')
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('đĩa và file chờ', () => {
  it('thư mục cài không ghi được: failed (không ném lỗi), vẫn giữ bản đang chạy', async () => {
    const u = make({ appDir: path.join(appDir, 'khong-ton-tai', 'sub') })
    await expect(u.offer(offer())).resolves.toBe('failed')
    await wait()
    expect(restart).not.toHaveBeenCalled()
  })

  it('tải hỏng thì GIỮ bản chờ hợp lệ của lần trước (cặp .new + .new.ver)', async () => {
    const prev = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(2048, 3)])
    writeFileSync(staged(), prev)
    writeFileSync(stagedVer(), '0.3.9\n')
    expect(await make().offer(offer({ sha256: 'f'.repeat(64) }))).toBe('failed')
    expect(readFileSync(staged())).toEqual(prev)
    expect(readFileSync(stagedVer(), 'utf8').trim()).toBe('0.3.9')
    expect(existsSync(part())).toBe(false)
  })

  it('bản chờ cũ hơn bị thay bằng cặp mới (nội dung và nhãn cùng đổi)', async () => {
    writeFileSync(staged(), Buffer.concat([Buffer.from('MZ'), Buffer.alloc(2048, 3)]))
    writeFileSync(stagedVer(), '0.3.9\n')
    expect(await make().offer(offer())).toBe('staged')
    expect(readFileSync(staged())).toEqual(EXE)
    expect(readFileSync(stagedVer(), 'utf8').trim()).toBe(NEW_VER)
  })

  it('bản chờ đúng nhãn nhưng nội dung hỏng/cụt: KHÔNG dùng lại, tải lại cho đúng', async () => {
    writeFileSync(staged(), Buffer.concat([Buffer.from('MZ'), Buffer.alloc(500, 9)]))
    writeFileSync(stagedVer(), `${NEW_VER}\n`)
    const fetchFn = vi.fn(okFetch())
    const u = make({ fetchFn: fetchFn as unknown as typeof fetch })
    expect(await u.offer(offer())).toBe('staged')
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(readFileSync(staged())).toEqual(EXE)
  })

  it('có nhãn nhưng mất .new: tải lại', async () => {
    writeFileSync(stagedVer(), `${NEW_VER}\n`)
    const fetchFn = vi.fn(okFetch())
    expect(await make({ fetchFn: fetchFn as unknown as typeof fetch }).offer(offer())).toBe(
      'staged',
    )
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('hai yêu cầu cùng lúc: chỉ tải một lần, yêu cầu sau nhận busy', async () => {
    let release = () => {}
    const gate = new Promise<void>((r) => {
      release = r
    })
    const fetchFn = vi.fn(async () => {
      await gate
      return new Response(new Uint8Array(EXE), { status: 200 })
    })
    const u = make({ fetchFn: fetchFn as unknown as typeof fetch })
    const first = u.offer(offer())
    expect(await u.offer(offer())).toBe('busy')
    release()
    expect(await first).toBe('staged')
    expect(fetchFn).toHaveBeenCalledTimes(1)
    await wait()
    expect(restart).toHaveBeenCalledTimes(1)
  })
})

describe('file update-failed.txt hỏng hoặc lạ', () => {
  it.each(['', '   \r\n', 'rác không phải phiên bản', '0.4'])(
    'nội dung %j bị bỏ qua, không chặn cập nhật',
    async (content) => {
      writeFileSync(path.join(dataDir, UPDATE_FAILED_FILE), content)
      expect(await make().offer(offer())).toBe('staged')
    },
  )

  it('phiên bản lỗi mới hơn bản đang được mời thì chặn (không hạ về bản từng hỏng)', async () => {
    writeFileSync(path.join(dataDir, UPDATE_FAILED_FILE), '0.5.0')
    const fetchFn = vi.fn(okFetch())
    const u = make({ fetchFn: fetchFn as unknown as typeof fetch })
    expect(await u.offer(offer())).toBe('blocked')
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('chống khởi động lại vô hạn khi run-gateway.cmd không thay được file', () => {
  const attemptFile = () => path.join(dataDir, UPDATE_ATTEMPT_FILE)
  const T0 = 5_000_000

  /** Mỗi lần gọi là một "tiến trình" mới (Gateway cũ chạy lại sau khi swap thất bại). */
  const freshProcess = (now: () => number, fetchFn?: typeof fetch) =>
    make({ now, ...(fetchFn ? { fetchFn } : {}) })

  it(`sau ${MAX_RESTART_ATTEMPTS} lần khởi động lại mà vẫn chưa lên bản mới thì dừng (looping)`, async () => {
    const fetchFn = vi.fn(okFetch()) as unknown as typeof fetch
    const now = () => T0
    for (let i = 0; i < MAX_RESTART_ATTEMPTS; i++) {
      expect(await freshProcess(now, fetchFn).offer(offer()), `lần ${i + 1}`).toBe('staged')
    }
    await wait()
    expect(restart).toHaveBeenCalledTimes(MAX_RESTART_ATTEMPTS)

    expect(await freshProcess(now, fetchFn).offer(offer())).toBe('looping')
    await wait()
    expect(restart).toHaveBeenCalledTimes(MAX_RESTART_ATTEMPTS)
    // Lần 1 tải; các lần sau dùng lại bản chờ (băm vẫn khớp) nên chỉ tải đúng một lần.
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('hết cửa sổ thời gian thì cho thử lại', async () => {
    let t = T0
    const now = () => t
    for (let i = 0; i < MAX_RESTART_ATTEMPTS; i++) await freshProcess(now).offer(offer())
    expect(await freshProcess(now).offer(offer())).toBe('looping')
    t += ATTEMPT_WINDOW_MS + 1
    expect(await freshProcess(now).offer(offer())).toBe('staged')
  })

  it('phiên bản mới hơn thì bộ đếm làm lại từ đầu', async () => {
    const now = () => T0
    for (let i = 0; i < MAX_RESTART_ATTEMPTS; i++) await freshProcess(now).offer(offer())
    expect(await freshProcess(now).offer(offer())).toBe('looping')
    expect(
      await freshProcess(now).offer(offer({ min_ver: '0.4.1', url: gatewayAssetUrl('0.4.1') })),
    ).toBe('staged')
    expect(JSON.parse(readFileSync(attemptFile(), 'utf8'))).toMatchObject({
      version: '0.4.1',
      count: 1,
    })
  })

  it('file đếm hỏng hoặc của phiên bản khác thì không chặn', async () => {
    writeFileSync(attemptFile(), '{{ không phải json')
    expect(await make().offer(offer())).toBe('staged')
    writeFileSync(attemptFile(), JSON.stringify({ version: '0.3.9', count: 99, at: Date.now() }))
    expect(await make().offer(offer())).toBe('staged')
  })

  it('không ghi được file đếm (dataDir mất) thì vẫn cập nhật bình thường', async () => {
    const u = make({ dataDir: path.join(dataDir, 'khong-ton-tai') })
    expect(await u.offer(offer())).toBe('staged')
  })

  it('markHealthy: đã chạy đúng bản được yêu cầu thì quên bộ đếm; chưa tới thì giữ', () => {
    writeFileSync(attemptFile(), JSON.stringify({ version: NEW_VER, count: 2, at: T0 }))
    make({ current: '0.3.7' }).markHealthy()
    expect(existsSync(attemptFile())).toBe(true)
    make({ current: NEW_VER }).markHealthy()
    expect(existsSync(attemptFile())).toBe(false)
  })
})

describe('markHealthy chịu được thư mục lỗi', () => {
  it('thư mục cài mất hoặc file bị khóa: không ném lỗi', () => {
    expect(() => make({ appDir: path.join(appDir, 'khong-ton-tai') }).markHealthy()).not.toThrow()
    expect(() => make({ appDir: null }).markHealthy()).not.toThrow()
  })
})
