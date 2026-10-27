import { createHash, randomBytes } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'
import {
  DEVICE_COOKIE,
  DEVICE_HEADER,
  type DeviceKind,
  deviceCookieHeader,
  deviceHashInput,
  isRawDeviceId,
} from '@az-sentinel/shared'

export type DeviceInfo = { id: string; kind: DeviceKind; ua: string }

const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v)

/** Mã thiết bị đã băm (32 ký tự hex): Server, BE và Gateway cùng công thức nên mã hiển thị khớp nhau. */
export function hashDeviceId(raw: string): string {
  return createHash('sha256').update(deviceHashInput(raw)).digest('hex').slice(0, 32)
}

export function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return undefined
}

/**
 * Request do trình duyệt thật gửi thì mới được cấp cookie thiết bị mới (script/curl không gửi `Sec-Fetch-*`).
 * Có hai kiểu: mở trang (`navigate`, khi vào thẳng VPS) và gọi API bằng fetch/XHR (`cors`/`same-origin` +
 * dest `empty`). Kiểu thứ hai là bắt buộc khi đi qua Worker Cloudflare: giao diện web do Worker phục vụ nên
 * lần mở trang không bao giờ tới VPS, chỉ có lời gọi `/api/*` tới. Thiếu kiểu này thì trình duyệt qua Worker
 * không bao giờ có mã thiết bị, bị chặn mà cũng không hiện ở danh sách chờ duyệt.
 */
function looksLikeBrowserPage(h: IncomingHttpHeaders): boolean {
  const mode = one(h['sec-fetch-mode'])
  if (mode) {
    if (mode === 'navigate') return true
    return (mode === 'cors' || mode === 'same-origin') && one(h['sec-fetch-dest']) === 'empty'
  }
  return (one(h.accept) ?? '').includes('text/html')
}

export function isHttps(h: IncomingHttpHeaders): boolean {
  const proto = one(h['x-forwarded-proto']) ?? ''
  return proto.toLowerCase().includes('https') || (one(h['cf-visitor']) ?? '').includes('https')
}

export type DeviceIdentity = {
  /** Null khi request không mang mã thiết bị nào (và không được cấp mới). */
  info: DeviceInfo | null
  /** Giá trị `Set-Cookie` cần gắn vào phản hồi khi vừa cấp mã thiết bị mới cho trình duyệt. */
  setCookie: string | null
}

/**
 * Nhận diện thiết bị của một request:
 * 1. Header `X-AZ-Device` (Gateway, mã nằm trong file `device.id`).
 * 2. Cookie `az_dev` (trình duyệt).
 * 3. Chưa có mà là trình duyệt mở trang (`mint`): cấp mã mới bằng cookie HttpOnly sống 400 ngày.
 * Mã thô không bao giờ rời hàm này: chỉ trả bản băm.
 */
export function identifyDevice(headers: IncomingHttpHeaders, mint: boolean): DeviceIdentity {
  const ua = (one(headers['user-agent']) ?? '').slice(0, 160)
  const fromHeader = one(headers[DEVICE_HEADER.toLowerCase()])?.trim()
  if (isRawDeviceId(fromHeader)) {
    return { info: { id: hashDeviceId(fromHeader), kind: 'gateway', ua }, setCookie: null }
  }
  const fromCookie = cookieValue(one(headers.cookie), DEVICE_COOKIE)
  if (isRawDeviceId(fromCookie)) {
    return { info: { id: hashDeviceId(fromCookie), kind: 'web', ua }, setCookie: null }
  }
  if (!mint || !looksLikeBrowserPage(headers)) return { info: null, setCookie: null }
  const raw = randomBytes(24).toString('base64url')
  return {
    info: { id: hashDeviceId(raw), kind: 'web', ua },
    setCookie: deviceCookieHeader(raw, isHttps(headers)),
  }
}
