import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { deviceHashInput, isRawDeviceId, shortDeviceId } from '@az-sentinel/shared'

export const DEVICE_FILE = 'device.id'

/**
 * Mã thiết bị của Gateway (whitelist thiết bị): chuỗi ngẫu nhiên tạo một lần và lưu trong `<dataDir>/device.id`,
 * gửi lên Server bằng header `X-AZ-Device`. Xóa file thì thành thiết bị mới (cần admin duyệt lại).
 * File hỏng/sai định dạng được tạo lại. Không ghi được file thì trả mã tạm (chỉ sống tới khi Gateway tắt).
 */
export function loadOrCreateDeviceId(dataDir: string): string {
  const file = path.join(dataDir, DEVICE_FILE)
  try {
    if (existsSync(file)) {
      const saved = readFileSync(file, 'utf8').trim()
      if (isRawDeviceId(saved)) return saved
    }
  } catch {
    // đọc lỗi: tạo mã mới bên dưới
  }
  const fresh = randomBytes(24).toString('base64url')
  try {
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(file, `${fresh}\n`, { encoding: 'utf8', mode: 0o600 })
  } catch {
    // không ghi được: dùng mã tạm
  }
  return fresh
}

/** Mã ngắn (8 ký tự) giống hệt mã quản trị viên thấy trên web, để người dùng đọc cho admin duyệt. */
export function shortCodeOf(raw: string): string {
  const hashed = createHash('sha256').update(deviceHashInput(raw)).digest('hex').slice(0, 32)
  return shortDeviceId(hashed)
}
