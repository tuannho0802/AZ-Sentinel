import type { IncomingHttpHeaders } from 'node:http'
import {
  DEVICE_COOKIE,
  DEVICE_HANDOFF_PARAM,
  deviceCookieHeader,
  isRawDeviceId,
} from '@az-sentinel/shared'
import { openDeviceHandoff } from '../../BE/src/edge/device-handoff'
import { cookieValue, isHttps } from './device-id'

/** Nhớ các vé đã dùng tới khi hết hạn, để một vé (lộ qua lịch sử trình duyệt, log...) không dùng lại được. */
export class HandoffNonces {
  private readonly used = new Map<string, number>()

  /** true nếu vé chưa từng dùng (và ghi nhận luôn); false nếu đã dùng rồi. */
  take(nonce: string, expSec: number, nowSec: number): boolean {
    for (const [k, exp] of this.used) if (exp < nowSec) this.used.delete(k)
    if (this.used.has(nonce)) return false
    // Trần cứng: vé hợp lệ chỉ sống 60 giây nên số này không bao giờ chạm trong dùng bình thường.
    if (this.used.size >= 10_000) return false
    this.used.set(nonce, expSec)
    return true
  }
}

export type HandoffOutcome = {
  /** Đường dẫn + query đã bỏ tham số vé: nơi trình duyệt được chuyển tới. */
  location: string
  /** `Set-Cookie` cần gắn (mã thiết bị của Worker); null khi vé hỏng, hết hạn, dùng lại hoặc cookie đã đúng. */
  setCookie: string | null
  /** Mã thiết bị thô của Worker, chỉ có khi `setCookie` được cấp: để Server dùng ngay cho request này (không cần chuyển hướng). */
  raw?: string
}

/**
 * Plan 3K: request GET mang vé trao mã thiết bị (`az_dh`) từ Worker. Luôn trả về đường dẫn sạch để chuyển hướng
 * (vé không nằm lại trên URL); chỉ cấp cookie khi vé giải được, còn hạn và chưa dùng. Vé hỏng thì bỏ qua êm,
 * trình duyệt vẫn đi tiếp như một thiết bị tự cấp cookie như trước. Không mang vé thì trả null.
 */
export async function handleDeviceHandoff(
  url: URL,
  headers: IncomingHttpHeaders,
  secret: string,
  nonces: HandoffNonces,
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<HandoffOutcome | null> {
  const token = url.searchParams.get(DEVICE_HANDOFF_PARAM)
  if (token === null) return null
  url.searchParams.delete(DEVICE_HANDOFF_PARAM)
  const location = `${url.pathname}${url.search}`
  const opened = secret === '' ? null : await openDeviceHandoff(secret, token, nowSec)
  if (!opened || !nonces.take(opened.nonce, opened.expSec, nowSec)) {
    return { location, setCookie: null }
  }
  const current = cookieValue(
    Array.isArray(headers.cookie) ? headers.cookie[0] : headers.cookie,
    DEVICE_COOKIE,
  )
  if (isRawDeviceId(current) && current === opened.raw) return { location, setCookie: null }
  return { location, setCookie: deviceCookieHeader(opened.raw, isHttps(headers)), raw: opened.raw }
}
