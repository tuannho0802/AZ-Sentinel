import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CHECK_BAD_INPUT, checkGatewayToken } from '../src/check-token'
import {
  applyConnectCodeToBody,
  editableSchema,
  loadConfig,
  saveEditableConfig,
  writeConnection,
} from '../src/config'
import { EventQueue } from '../src/queue'

const TOKEN = `azt_${'A'.repeat(32)}`
const posix = process.platform !== 'win32'

let dir: string
let env: NodeJS.ProcessEnv
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'az-gw-sec-'))
  env = { AZ_GW_DATA: dir, AZ_GW_CONFIG: path.join(dir, 'config.json') }
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('địa chỉ cloud không mã hóa', () => {
  it('loadConfig từ chối ws:// ra internet (cả chính lẫn dự phòng)', () => {
    expect(() => loadConfig({ ...env, AZ_GW_CLOUD_URL: 'ws://az.workers.dev/api/gw/ws' })).toThrow(
      'cloudUrl',
    )
    expect(() =>
      loadConfig({ ...env, AZ_GW_CLOUD_FALLBACK_URL: 'ws://203.0.113.9:8080/api/gw/ws' }),
    ).toThrow('cloudFallbackUrl')
  })

  it.each([
    'wss://az.workers.dev/api/gw/ws',
    'ws://127.0.0.1:8080/api/gw/ws',
    'ws://192.168.1.5:8080/api/gw/ws',
  ])('loadConfig vẫn nhận %s', (url) => {
    expect(loadConfig({ ...env, AZ_GW_CLOUD_URL: url }).cloudUrl).toBe(url)
  })

  it('giao diện cục bộ (editableSchema) từ chối ws:// ra internet', () => {
    const base = { cloudToken: '', vps: 'VPS', idleFlushSec: 0 }
    expect(editableSchema.safeParse({ ...base, cloudUrl: 'ws://az.workers.dev/x' }).success).toBe(
      false,
    )
    expect(
      editableSchema.safeParse({ ...base, cloudUrl: '', cloudFallbackUrl: 'ws://8.8.8.8/x' })
        .success,
    ).toBe(false)
    expect(editableSchema.safeParse({ ...base, cloudUrl: 'wss://az.workers.dev/x' }).success).toBe(
      true,
    )
  })

  it('mã kết nối mang ws:// công khai bị từ chối ở bước lưu', () => {
    const body = {
      cloudUrl: 'wss://ok.workers.dev/api/gw/ws',
      vps: 'VPS',
      idleFlushSec: 0,
      cloudToken: '',
    }
    const applied = applyConnectCodeToBody(body)
    expect(applied.ok).toBe(true)
    // Cùng đường kiểm tra như route /v1/ui/config: giá trị cuối vẫn phải qua editableSchema.
    const bad = { ...body, cloudUrl: 'ws://evil.example.com/api/gw/ws' }
    expect(editableSchema.safeParse(bad).success).toBe(false)
  })

  it('check-token không gửi token qua ws:// công khai (không gọi mạng)', async () => {
    let called = 0
    const fetchImpl = (async () => {
      called++
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch
    const r = await checkGatewayToken('ws://az.workers.dev/api/gw/ws', TOKEN, fetchImpl)
    expect(r.code).toBe(CHECK_BAD_INPUT)
    expect(called).toBe(0)
    const ok = await checkGatewayToken('wss://az.workers.dev/api/gw/ws', TOKEN, fetchImpl)
    expect(ok.code).toBe(0)
    expect(called).toBe(1)
  })
})

describe.skipIf(!posix)('quyền file chứa token (Linux/macOS)', () => {
  const mode = (f: string) => statSync(f).mode & 0o777

  it('saveEditableConfig và writeConnection ghi config.json quyền 0600', () => {
    saveEditableConfig(
      {
        cloudUrl: 'wss://az.workers.dev/api/gw/ws',
        cloudToken: TOKEN,
        vps: 'VPS',
        idleFlushSec: 0,
      },
      env,
    )
    const file = env.AZ_GW_CONFIG as string
    expect(mode(file)).toBe(0o600)
    expect(JSON.parse(readFileSync(file, 'utf8')).cloudToken).toBe(TOKEN)

    rmSync(file)
    writeConnection({ primaryUrl: 'wss://a.workers.dev/x', fallbackUrl: '', token: TOKEN }, env)
    expect(mode(file)).toBe(0o600)
  })

  it('thư mục dữ liệu mới tạo quyền 0700', () => {
    const nested = path.join(dir, 'moi', 'con')
    writeConnection(
      { primaryUrl: 'wss://a.workers.dev/x', fallbackUrl: '', token: TOKEN },
      { AZ_GW_CONFIG: path.join(nested, 'config.json') },
    )
    expect(statSync(nested).mode & 0o777).toBe(0o700)
  })

  it('hàng đợi sự kiện (queue.json) quyền 0600', () => {
    const file = path.join(dir, 'queue.json')
    const q = new EventQueue(file)
    q.push({ tid: 't', seq: 1, reason: 'event', events: [] } as never)
    q.flush()
    expect(mode(file)).toBe(0o600)
    writeFileSync(path.join(dir, 'x'), '')
  })
})
