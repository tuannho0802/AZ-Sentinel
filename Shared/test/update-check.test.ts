import { describe, expect, it } from 'vitest'
import {
  compareVersions,
  isReleaseVersion,
  latestRelease,
  RELEASES_PAGE_URL,
  serverInfoSchema,
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
