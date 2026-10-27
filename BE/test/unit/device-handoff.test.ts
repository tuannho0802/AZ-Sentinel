import { DEVICE_HANDOFF_TTL_SEC, isRawDeviceId } from '@az-sentinel/shared'
import { describe, expect, it } from 'vitest'
import { openDeviceHandoff, sealDeviceHandoff } from '../../src/edge/device-handoff'

const SECRET = 'sync-token-0123456789-abcdefghijkl'
const RAW = 'AbCdEfGhIjKlMnOpQrStUvWx'
const NOW = 1_800_000_000

describe('vé trao mã thiết bị (Plan 3K)', () => {
  it('seal rồi open trả đúng mã thiết bị, mốc hết hạn và nonce', async () => {
    const t = await sealDeviceHandoff(SECRET, RAW, NOW)
    const o = await openDeviceHandoff(SECRET, t, NOW + 5)
    expect(o?.raw).toBe(RAW)
    expect(o?.expSec).toBe(NOW + DEVICE_HANDOFF_TTL_SEC)
    expect(o?.nonce).toMatch(/^[A-Za-z0-9_-]{16}$/)
  })

  it('mã thiết bị thô KHÔNG nằm lộ trong vé và vé chỉ gồm ký tự an toàn cho URL', async () => {
    const t = await sealDeviceHandoff(SECRET, RAW, NOW)
    expect(t).not.toContain(RAW)
    expect(t).toMatch(/^v1\.[A-Za-z0-9_-]+$/)
    expect(encodeURIComponent(t)).toBe(t)
  })

  it('mỗi vé có nonce khác nhau dù cùng mã và cùng thời điểm', async () => {
    const a = await openDeviceHandoff(SECRET, await sealDeviceHandoff(SECRET, RAW, NOW), NOW)
    const b = await openDeviceHandoff(SECRET, await sealDeviceHandoff(SECRET, RAW, NOW), NOW)
    expect(a?.nonce).not.toBe(b?.nonce)
  })

  it('sai khóa chung thì từ chối', async () => {
    const t = await sealDeviceHandoff(SECRET, RAW, NOW)
    expect(await openDeviceHandoff(`${SECRET}x`, t, NOW)).toBeNull()
  })

  it('secret rỗng thì không mở được gì', async () => {
    const t = await sealDeviceHandoff(SECRET, RAW, NOW)
    expect(await openDeviceHandoff('', t, NOW)).toBeNull()
  })

  it('hết hạn thì từ chối; sát hạn vẫn nhận', async () => {
    const t = await sealDeviceHandoff(SECRET, RAW, NOW)
    expect(await openDeviceHandoff(SECRET, t, NOW + DEVICE_HANDOFF_TTL_SEC)).not.toBeNull()
    expect(await openDeviceHandoff(SECRET, t, NOW + DEVICE_HANDOFF_TTL_SEC + 1)).toBeNull()
  })

  it('vé ký cho tương lai quá xa (đồng hồ lệch hoặc làm giả hạn) bị từ chối', async () => {
    const t = await sealDeviceHandoff(SECRET, RAW, NOW + 3600)
    expect(await openDeviceHandoff(SECRET, t, NOW)).toBeNull()
  })

  it('vé bị sửa dù một ký tự thì từ chối (GCM xác thực)', async () => {
    const t = await sealDeviceHandoff(SECRET, RAW, NOW)
    const i = t.length - 3
    const flipped = `${t.slice(0, i)}${t[i] === 'A' ? 'B' : 'A'}${t.slice(i + 1)}`
    expect(await openDeviceHandoff(SECRET, flipped, NOW)).toBeNull()
  })

  it.each([
    ['rỗng', ''],
    ['không có tiền tố', 'abcdef'],
    ['tiền tố lạ', 'v2.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'],
    ['thừa đoạn', 'v1.AAAA.BBBB'],
    ['ký tự cấm', 'v1.@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@'],
    ['quá ngắn', 'v1.AAAA'],
    ['quá dài', `v1.${'A'.repeat(600)}`],
  ])('từ chối vé sai định dạng: %s', async (_n, token) => {
    expect(await openDeviceHandoff(SECRET, token, NOW)).toBeNull()
  })

  it('mã thiết bị không hợp lệ bên trong vé (ký bằng khóa đúng) vẫn bị từ chối', async () => {
    const t = await sealDeviceHandoff(SECRET, 'ngan', NOW)
    expect(isRawDeviceId('ngan')).toBe(false)
    expect(await openDeviceHandoff(SECRET, t, NOW)).toBeNull()
  })
})
