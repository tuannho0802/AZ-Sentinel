import { mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config'

const dir = mkdtempSync(path.join(os.tmpdir(), 'az-cfg-'))
const base = { AZ_DATA: dir, AZ_ENV_FILE: path.join(dir, 'khong-co.env') }
const WORKER = 'https://az-sentinel-api.acc.workers.dev'

describe('cấu hình Quick Tunnel plug and play (Plan 3H)', () => {
  it('bật Quick Tunnel mà không đặt AZ_PUBLIC_URL: mã kết nối lấy địa chỉ Worker (cố định)', () => {
    const cfg = loadConfig({ ...base, AZ_QUICK_TUNNEL: '1', AZ_CLOUD_URL: `${WORKER}/` })
    expect(cfg.publicUrl).toBe(WORKER)
  })

  it('đã đặt AZ_PUBLIC_URL thì giữ nguyên, không ghi đè', () => {
    const cfg = loadConfig({
      ...base,
      AZ_QUICK_TUNNEL: '1',
      AZ_CLOUD_URL: WORKER,
      AZ_PUBLIC_URL: 'https://az.example.com',
    })
    expect(cfg.publicUrl).toBe('https://az.example.com')
  })

  it('không bật Quick Tunnel: không tự đặt địa chỉ công khai (người dùng tunnel có tên không bị đổi hành vi)', () => {
    expect(loadConfig({ ...base, AZ_CLOUD_URL: WORKER }).publicUrl).toBe('')
  })

  it('bộ cài tự ghi AZ_QUICK_TUNNEL=1 khi có Worker + SYNC_TOKEN và không có URL công khai/token tunnel có tên', () => {
    const iss = readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../Installer/az-server.iss'),
      'utf8',
    )
    expect(iss).toContain("'AZ_QUICK_TUNNEL=1'")
    expect(iss).toMatch(/Length\(Trim\(SrvPage\.Values\[5\]\)\) >= 32/)
  })

  it('bản dự phòng mặc định là địa chỉ Worker (Worker phục vụ luôn giao diện); đặt tay thì giữ nguyên', () => {
    expect(loadConfig({ ...base, AZ_CLOUD_URL: `${WORKER}/` }).fallbackUrl).toBe(WORKER)
    expect(
      loadConfig({ ...base, AZ_CLOUD_URL: WORKER, AZ_FALLBACK_URL: 'https://az.example.com' })
        .fallbackUrl,
    ).toBe('https://az.example.com')
    expect(loadConfig({ ...base }).fallbackUrl).toBe('')
  })
})