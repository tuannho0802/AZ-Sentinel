import { describe, expect, it } from 'vitest'
import {
  compareVersions,
  gatewayAssetUrl,
  isReleaseVersion,
  latestGatewayRelease,
  latestRelease,
  parseSha256Sums,
  RELEASES_PAGE_URL,
  serverInfoSchema,
  sha256SumsUrl,
  updateStatusSchema,
} from '../src'

const rel = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  html_url: `${RELEASES_PAGE_URL}/tag/${tag}`,
  draft: false,
  prerelease: false,
  ...extra,
})

describe('compareVersions', () => {
  it('so theo số từng phần, không theo chuỗi, và bỏ tiền tố v', () => {
    expect(compareVersions('0.2.10', '0.2.9')).toBeGreaterThan(0)
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('0.1.0', '0.2.0')).toBeLessThan(0)
    expect(compareVersions('1.0.0', '0.99.99')).toBeGreaterThan(0)
  })
})

describe('isReleaseVersion', () => {
  it('chỉ nhận x.y.z thuần', () => {
    expect(isReleaseVersion('0.2.3')).toBe(true)
    expect(isReleaseVersion('v1.10.0')).toBe(true)
    for (const bad of ['dev', '', '1.2', '1.2.3-beta', '1.2.3.4', 'a.b.c', undefined, null]) {
      expect(isReleaseVersion(bad)).toBe(false)
    }
  })
})

describe('latestRelease', () => {
  const list = [
    rel('server-v0.2.3'),
    rel('gateway-v0.3.2'),
    rel('server-v0.2.10'),
    rel('gateway-v0.4.0'),
    rel('server-v0.2.9'),
  ]

  it('chọn bản lớn nhất của đúng loại, bỏ qua loại kia', () => {
    expect(latestRelease(list, 'server', '0.2.3')?.latest).toBe('0.2.10')
    expect(latestRelease(list, 'gateway', '0.3.2')?.latest).toBe('0.4.0')
  })

  it('available chỉ khi bản mới nhất lớn hơn bản đang chạy', () => {
    expect(latestRelease(list, 'server', '0.2.3')?.available).toBe(true)
    expect(latestRelease(list, 'server', '0.2.10')?.available).toBe(false)
    expect(latestRelease(list, 'server', '9.0.0')?.available).toBe(false)
  })

  it('bản đang chạy không phải số phát hành (dev) thì không bao giờ báo có bản mới', () => {
    expect(latestRelease(list, 'server', 'dev')?.available).toBe(false)
    expect(latestRelease(list, 'server', '0.1.0-beta')?.available).toBe(false)
  })

  it('bỏ bản nháp, bản thử và tag sai dạng', () => {
    const noisy = [
      rel('server-v9.9.9', { draft: true }),
      rel('server-v8.8.8', { prerelease: true }),
      rel('server-vabc'),
      rel('server-v1.2'),
      rel('v7.7.7'),
      rel('server-v0.2.4'),
    ]
    expect(latestRelease(noisy, 'server', '0.2.3')).toEqual({
      latest: '0.2.4',
      url: `${RELEASES_PAGE_URL}/tag/server-v0.2.4`,
      available: true,
    })
  })

  it('chưa có release loại đó hoặc dữ liệu lạ thì trả null', () => {
    expect(latestRelease([rel('gateway-v0.3.2')], 'server', '0.2.3')).toBeNull()
    expect(latestRelease([], 'server', '0.2.3')).toBeNull()
    expect(latestRelease({ message: 'rate limited' }, 'server', '0.2.3')).toBeNull()
    expect(latestRelease([null, 5, 'x'], 'server', '0.2.3')).toBeNull()
  })

  it('địa chỉ không thuộc repo của dự án bị thay bằng trang releases', () => {
    const out = latestRelease(
      [rel('server-v0.3.0', { html_url: 'javascript:alert(1)' })],
      'server',
      '0.2.3',
    )
    expect(out?.url).toBe(RELEASES_PAGE_URL)
    const other = latestRelease(
      [rel('server-v0.3.0', { html_url: 'https://evil.test/tuannho0802/AZ-Sentinel/releases/x' })],
      'server',
      '0.2.3',
    )
    expect(other?.url).toBe(RELEASES_PAGE_URL)
  })
})

describe('schema', () => {
  it('updateStatusSchema nhận trạng thái chưa kiểm tra và đã kiểm tra', () => {
    expect(updateStatusSchema.safeParse({ server: null, checkedAt: null }).success).toBe(true)
    expect(
      updateStatusSchema.safeParse({
        server: { latest: '0.3.0', url: RELEASES_PAGE_URL, available: true },
        checkedAt: 1_700_000_000,
      }).success,
    ).toBe(true)
  })

  it('serverInfoSchema vẫn nhận phản hồi cũ (không có update) và mới (có update)', () => {
    const node = {
      role: 'vps',
      name: 'VPS',
      host: null,
      os: null,
      arch: null,
      runtime: 'node',
      version: '0.2.3',
      startedAt: 1,
      uptimeSec: 1,
      cpuCount: null,
      memTotalMb: null,
      memFreeMb: null,
      cpuPct: null,
      location: null,
    }
    const base = {
      mode: 'primary',
      active: node,
      primary: { configured: true, status: 'up', lastSeenAt: 1, info: node },
      standby: null,
      gateways: 0,
      viewers: 0,
      checkedAt: 1,
    }
    expect(serverInfoSchema.safeParse(base).success).toBe(true)
    expect(
      serverInfoSchema.safeParse({ ...base, update: { server: null, checkedAt: null } }).success,
    ).toBe(true)
  })
})

describe('tự cập nhật Gateway: địa chỉ và băm', () => {
  const H = 'a'.repeat(64)

  it('gatewayAssetUrl dựng từ repo và tag, không lấy từ nguồn ngoài', () => {
    expect(gatewayAssetUrl('0.4.0')).toBe(
      'https://github.com/tuannho0802/AZ-Sentinel/releases/download/gateway-v0.4.0/az-gateway.exe',
    )
    expect(sha256SumsUrl('0.4.0')).toBe(
      'https://github.com/tuannho0802/AZ-Sentinel/releases/download/gateway-v0.4.0/SHA256SUMS.txt',
    )
  })

  it('parseSha256Sums đọc đúng dòng theo tên file (có hoặc không dấu *)', () => {
    const text = `${H}  AZSentinel-Gateway-Setup.exe\r\n${'B'.repeat(64)} *az-gateway.exe\r\n`
    expect(parseSha256Sums(text, 'az-gateway.exe')).toBe('b'.repeat(64))
    expect(parseSha256Sums(text, 'AZSentinel-Gateway-Setup.exe')).toBe(H)
    expect(parseSha256Sums(text, 'khac.exe')).toBeNull()
    expect(parseSha256Sums('rác\nabc  az-gateway.exe', 'az-gateway.exe')).toBeNull()
  })

  it('latestGatewayRelease chỉ chọn release đủ exe và file băm', () => {
    const full = [{ name: 'az-gateway.exe' }, { name: 'SHA256SUMS.txt' }]
    const list = [
      { tag_name: 'gateway-v0.3.7', assets: [{ name: 'AZSentinel-Gateway-Setup.exe' }] },
      { tag_name: 'gateway-v0.4.0', assets: full },
      { tag_name: 'gateway-v0.5.0', assets: full, prerelease: true },
      { tag_name: 'gateway-v0.6.0', assets: full, draft: true },
      { tag_name: 'gateway-v0.7.0', assets: [{ name: 'az-gateway.exe' }] },
      { tag_name: 'server-v9.9.9', assets: full },
      { tag_name: 'gateway-v0.4.1', assets: full },
    ]
    expect(latestGatewayRelease(list)).toBe('0.4.1')
    expect(latestGatewayRelease([{ tag_name: 'gateway-v0.3.7', assets: [] }])).toBeNull()
    expect(latestGatewayRelease('x')).toBeNull()
  })
})
