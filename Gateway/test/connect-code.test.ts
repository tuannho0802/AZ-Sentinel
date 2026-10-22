import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { encodeConnectCode } from '@az-sentinel/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import { CHECK_BAD_INPUT, CHECK_INVALID, CHECK_OK, CHECK_UNREACHABLE } from '../src/check-token'
import { applyConnectCodeToBody, configFilePath, loadConfig, writeConnection } from '../src/config'
import { runApplyCode, runCheckCode } from '../src/connect-code'

const TOKEN = 'azt_dev0123456789abcdef0123456789ab'
const PRIMARY = 'wss://vps.example.com/api/gw/ws'
const FALLBACK = 'wss://az.workers.dev/api/gw/ws'
const CODE = encodeConnectCode({
  primaryUrl: PRIMARY,
  fallbackUrl: FALLBACK,
  token: TOKEN,
}) as string
const CODE_SOLO = encodeConnectCode({
  primaryUrl: PRIMARY,
  fallbackUrl: '',
  token: TOKEN,
}) as string

/** Giả lập fetch theo host: `{ 'vps.example.com': 200 | 401 | 'down' }`. */
function byHost(map: Record<string, number | 'down'>, seen: string[] = []): typeof fetch {
  return (async (input: unknown) => {
    const host = new URL(String(input)).host
    seen.push(host)
    const r = map[host]
    if (r === undefined || r === 'down') throw new TypeError('fetch failed')
    return new Response(r === 200 ? '{"ok":true}' : null, { status: r })
  }) as unknown as typeof fetch
}

describe('runCheckCode', () => {
  const run = async (code: string, f: typeof fetch) => {
    const lines: string[] = []
    const rc = await runCheckCode([code], (l) => lines.push(l), f)
    return { rc, text: lines.join('\n') }
  }

  it('mã hợp lệ và VPS chính chấp nhận: 0, không hỏi dự phòng', async () => {
    const seen: string[] = []
    const r = await run(CODE, byHost({ 'vps.example.com': 200 }, seen))
    expect(r.rc).toBe(CHECK_OK)
    expect(seen).toEqual(['vps.example.com'])
  })

  it('VPS chính từ chối token: 1 ngay, không thử dự phòng', async () => {
    const seen: string[] = []
    const r = await run(CODE, byHost({ 'vps.example.com': 401, 'az.workers.dev': 200 }, seen))
    expect(r.rc).toBe(CHECK_INVALID)
    expect(seen).toEqual(['vps.example.com'])
  })

  it('VPS chính sập, dự phòng chấp nhận: 0', async () => {
    const seen: string[] = []
    const r = await run(CODE, byHost({ 'vps.example.com': 'down', 'az.workers.dev': 200 }, seen))
    expect(r.rc).toBe(CHECK_OK)
    expect(seen).toEqual(['vps.example.com', 'az.workers.dev'])
  })

  it('VPS chính sập, dự phòng từ chối: 1', async () => {
    const r = await run(CODE, byHost({ 'vps.example.com': 'down', 'az.workers.dev': 401 }))
    expect(r.rc).toBe(CHECK_INVALID)
  })

  it('cả hai không đáp: 2; không có dự phòng thì chỉ hỏi một nơi', async () => {
    const seen: string[] = []
    expect((await run(CODE, byHost({}, seen))).rc).toBe(CHECK_UNREACHABLE)
    expect(seen).toEqual(['vps.example.com', 'az.workers.dev'])
    const seen2: string[] = []
    expect((await run(CODE_SOLO, byHost({}, seen2))).rc).toBe(CHECK_UNREACHABLE)
    expect(seen2).toEqual(['vps.example.com'])
  })

  it('mã sai hoặc rỗng: 3, không gọi mạng và không in token', async () => {
    const seen: string[] = []
    for (const bad of ['', 'azt_dev0123456789abcdef0123456789ab', 'azc1.@@@', 'azc1.eyJ2IjoxfQ']) {
      const r = await run(bad, byHost({ 'vps.example.com': 200 }, seen))
      expect(r.rc).toBe(CHECK_BAD_INPUT)
      expect(r.text).not.toContain(TOKEN)
    }
    expect(seen).toEqual([])
  })

  it('không bao giờ in token hay mã ra output', async () => {
    for (const f of [
      byHost({ 'vps.example.com': 200 }),
      byHost({ 'vps.example.com': 401 }),
      byHost({}),
    ]) {
      const r = await run(CODE, f)
      expect(r.text).not.toContain(TOKEN)
      expect(r.text).not.toContain('azc1.')
    }
  })
})

describe('writeConnection / runApplyCode', () => {
  let dir: string
  let env: NodeJS.ProcessEnv
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'azgw-code-'))
    env = { AZ_GW_DATA: dir }
  })
  const read = () => JSON.parse(readFileSync(configFilePath(env), 'utf8'))

  it('tạo config.json khi chưa có, loadConfig đọc lại đúng', () => {
    writeConnection(
      { primaryUrl: PRIMARY, fallbackUrl: FALLBACK, token: TOKEN, vps: 'VPS-A9' },
      env,
    )
    const cfg = loadConfig(env)
    expect(cfg).toMatchObject({
      cloudUrl: PRIMARY,
      cloudFallbackUrl: FALLBACK,
      cloudToken: TOKEN,
      vps: 'VPS-A9',
    })
  })

  it('giữ nguyên các khóa khác (port, logLevel) và tên VPS cũ nếu không truyền vps', () => {
    writeFileSync(
      configFilePath(env),
      JSON.stringify({ port: 47801, logLevel: 'debug', vps: 'CU', cloudToken: 'old' }),
    )
    writeConnection({ primaryUrl: PRIMARY, fallbackUrl: '', token: TOKEN }, env)
    expect(read()).toMatchObject({
      port: 47801,
      logLevel: 'debug',
      vps: 'CU',
      cloudUrl: PRIMARY,
      cloudFallbackUrl: '',
      cloudToken: TOKEN,
    })
  })

  it('nhận mã mới ghi đè địa chỉ dự phòng cũ bằng chuỗi rỗng khi mã không có dự phòng', () => {
    writeConnection({ primaryUrl: PRIMARY, fallbackUrl: FALLBACK, token: TOKEN }, env)
    writeConnection({ primaryUrl: PRIMARY, fallbackUrl: '', token: TOKEN }, env)
    expect(read().cloudFallbackUrl).toBe('')
  })

  it('config.json hỏng JSON: báo lỗi, không ghi đè', () => {
    writeFileSync(configFilePath(env), '{not json')
    expect(() =>
      writeConnection({ primaryUrl: PRIMARY, fallbackUrl: '', token: TOKEN }, env),
    ).toThrow(/hỏng JSON/)
    expect(readFileSync(configFilePath(env), 'utf8')).toBe('{not json')
  })

  it('runApplyCode: mã đúng thì ghi và trả 0; mã sai trả 3 và không tạo file', () => {
    const prev = process.env.AZ_GW_DATA
    process.env.AZ_GW_DATA = dir
    try {
      const lines: string[] = []
      expect(runApplyCode([CODE, 'VPS-Z'], (l) => lines.push(l))).toBe(CHECK_OK)
      expect(read()).toMatchObject({ cloudUrl: PRIMARY, cloudToken: TOKEN, vps: 'VPS-Z' })
      expect(lines.join('')).not.toContain(TOKEN)
    } finally {
      process.env.AZ_GW_DATA = prev
    }
    const dir2 = mkdtempSync(path.join(os.tmpdir(), 'azgw-code2-'))
    process.env.AZ_GW_DATA = dir2
    try {
      expect(runApplyCode(['azc1.xxx', 'V'])).toBe(CHECK_BAD_INPUT)
      expect(() => readFileSync(path.join(dir2, 'config.json'))).toThrow()
    } finally {
      process.env.AZ_GW_DATA = prev
    }
  })

  it('runApplyCode: tên VPS dài quá 64 ký tự bị cắt, tên rỗng giữ tên cũ', () => {
    const prev = process.env.AZ_GW_DATA
    process.env.AZ_GW_DATA = dir
    try {
      runApplyCode([CODE, 'x'.repeat(100)], () => {})
      expect(read().vps).toHaveLength(64)
      runApplyCode([CODE, '   '], () => {})
      expect(read().vps).toHaveLength(64)
    } finally {
      process.env.AZ_GW_DATA = prev
    }
  })
})

describe('applyConnectCodeToBody (giao diện cục bộ)', () => {
  const typed = {
    cloudUrl: 'wss://tay/ws',
    cloudFallbackUrl: '',
    cloudToken: '',
    vps: 'V',
    idleFlushSec: 5,
  }

  it('có mã: ghi đè URL và token gõ tay, bỏ trường connectCode', () => {
    const r = applyConnectCodeToBody({ ...typed, connectCode: `  ${CODE}  ` })
    expect(r).toEqual({
      ok: true,
      body: {
        ...typed,
        cloudUrl: PRIMARY,
        cloudFallbackUrl: FALLBACK,
        cloudToken: TOKEN,
      },
    })
  })

  it('mã rỗng hoặc không có: giữ nguyên body và bỏ trường connectCode', () => {
    expect(applyConnectCodeToBody({ ...typed, connectCode: '' })).toEqual({ ok: true, body: typed })
    expect(applyConnectCodeToBody({ ...typed, connectCode: '   ' })).toEqual({
      ok: true,
      body: typed,
    })
    expect(applyConnectCodeToBody(typed)).toEqual({ ok: true, body: typed })
  })

  it('mã sai hoặc không phải chuỗi: lỗi connect_code_invalid', () => {
    expect(applyConnectCodeToBody({ ...typed, connectCode: 'azc1.hong' })).toEqual({
      ok: false,
      error: 'connect_code_invalid',
    })
    expect(applyConnectCodeToBody({ ...typed, connectCode: 123 })).toEqual({
      ok: false,
      error: 'connect_code_invalid',
    })
  })

  it('body không phải object: trả nguyên để schema báo lỗi', () => {
    expect(applyConnectCodeToBody(null)).toEqual({ ok: true, body: null })
    expect(applyConnectCodeToBody('x')).toEqual({ ok: true, body: 'x' })
  })
})
