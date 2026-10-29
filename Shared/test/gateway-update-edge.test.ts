import { describe, expect, it } from 'vitest'
import {
  GATEWAY_EXE_ASSET,
  gatewayAssetUrl,
  latestGatewayRelease,
  parseSha256Sums,
  SHA256SUMS_ASSET,
} from '../src/update-check'

const H = 'a'.repeat(64)
const withAssets = (tag: string, names: unknown[] = [GATEWAY_EXE_ASSET, SHA256SUMS_ASSET]) => ({
  tag_name: tag,
  draft: false,
  prerelease: false,
  assets: names.map((name) => ({ name })),
})

describe('parseSha256Sums: dữ liệu lạ', () => {
  it('chuỗi rỗng, chỉ khoảng trắng, hoặc không có dòng hợp lệ: null', () => {
    for (const t of ['', '   \n\r\n', 'không phải file băm', `${H}`, `${H} `]) {
      expect(parseSha256Sums(t, GATEWAY_EXE_ASSET), JSON.stringify(t)).toBeNull()
    }
  })

  it('băm HOA được đổi thành chữ thường; CRLF và dấu * chế độ nhị phân đều đọc được', () => {
    expect(parseSha256Sums(`${H.toUpperCase()} *az-gateway.exe\r\n`, GATEWAY_EXE_ASSET)).toBe(H)
  })

  it('tên file phải khớp đúng: không nhận hậu tố, tiền tố hay đường dẫn', () => {
    for (const name of [
      'az-gateway.exe.old',
      'old-az-gateway.exe',
      'dist/az-gateway.exe',
      'AZ-GATEWAY.EXE',
    ]) {
      expect(parseSha256Sums(`${H}  ${name}\n`, GATEWAY_EXE_ASSET), name).toBeNull()
    }
  })

  it('băm sai độ dài hoặc không phải hex: bỏ dòng đó', () => {
    expect(parseSha256Sums(`${'a'.repeat(63)}  az-gateway.exe\n`, GATEWAY_EXE_ASSET)).toBeNull()
    expect(parseSha256Sums(`${'a'.repeat(65)}  az-gateway.exe\n`, GATEWAY_EXE_ASSET)).toBeNull()
    expect(parseSha256Sums(`${'g'.repeat(64)}  az-gateway.exe\n`, GATEWAY_EXE_ASSET)).toBeNull()
  })

  it('nhiều dòng cùng tên file: lấy dòng đầu tiên hợp lệ', () => {
    const second = 'b'.repeat(64)
    expect(
      parseSha256Sums(`${H}  az-gateway.exe\n${second}  az-gateway.exe\n`, GATEWAY_EXE_ASSET),
    ).toBe(H)
  })
})

describe('latestGatewayRelease: dữ liệu lạ từ GitHub', () => {
  it('không phải mảng, null, mảng rỗng: null', () => {
    for (const v of [null, undefined, {}, 'x', 5, []]) {
      expect(latestGatewayRelease(v)).toBeNull()
    }
  })

  it('phần tử null/không phải đối tượng thì bỏ qua, không ném lỗi', () => {
    expect(latestGatewayRelease([null, 5, 'x', withAssets('gateway-v0.4.0')])).toBe('0.4.0')
  })

  it('assets thiếu, null, không phải mảng, hoặc chứa phần tử lạ: không chọn bản đó, không ném lỗi', () => {
    const base = { tag_name: 'gateway-v0.9.0', draft: false, prerelease: false }
    expect(
      latestGatewayRelease([base, { ...base, assets: null }, { ...base, assets: 'x' }]),
    ).toBeNull()
    expect(latestGatewayRelease([withAssets('gateway-v0.9.0', [null, 5, undefined])])).toBeNull()
  })

  it('thiếu một trong hai file (exe hoặc băm): không chọn', () => {
    expect(latestGatewayRelease([withAssets('gateway-v0.9.0', [GATEWAY_EXE_ASSET])])).toBeNull()
    expect(latestGatewayRelease([withAssets('gateway-v0.9.0', [SHA256SUMS_ASSET])])).toBeNull()
  })

  it('bản mới nhất thiếu file thì lùi về bản đủ file gần nhất', () => {
    expect(
      latestGatewayRelease([
        withAssets('gateway-v0.5.0', [GATEWAY_EXE_ASSET]),
        withAssets('gateway-v0.4.0'),
      ]),
    ).toBe('0.4.0')
  })

  it('so sánh theo số (0.10.0 > 0.9.0), không theo chuỗi', () => {
    expect(
      latestGatewayRelease([withAssets('gateway-v0.9.0'), withAssets('gateway-v0.10.0')]),
    ).toBe('0.10.0')
  })

  it('bỏ bản nháp, bản thử, tag sai dạng và tag của Server', () => {
    const list = [
      { ...withAssets('gateway-v9.0.0'), draft: true },
      { ...withAssets('gateway-v8.0.0'), prerelease: true },
      withAssets('gateway-v7.0.0-rc1'),
      withAssets('gateway-v7'),
      withAssets('server-v6.0.0'),
      withAssets('gateway-v0.4.0'),
    ]
    expect(latestGatewayRelease(list)).toBe('0.4.0')
  })
})

describe('gatewayAssetUrl', () => {
  it('luôn nằm trong repo của dự án, dạng cố định theo tag', () => {
    expect(gatewayAssetUrl('0.4.0')).toMatch(
      /^https:\/\/github\.com\/[^/]+\/AZ-Sentinel\/releases\/download\/gateway-v0\.4\.0\/az-gateway\.exe$/,
    )
  })
})
