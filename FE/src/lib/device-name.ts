import { useEffect, useState } from 'react'

/**
 * Đặt tên thiết bị dễ nhận ra cho quản trị viên (ví dụ "Galaxy S23 Ultra của Tuấn").
 *
 * Không dùng thư viện ngoài: ua-parser-js từ v2 đổi sang giấy phép AGPL-3.0 (ràng buộc mã nguồn khi triển
 * khai), còn các bản MIT cũ (v1) không còn cập nhật. Phần cần ở đây nhỏ (trình duyệt, hệ điều hành, mã
 * máy Android) nên tự viết và có test.
 *
 * Giới hạn trung thực: Chrome trên Android đã "rút gọn" User-Agent (model hiện là chữ "K"), iPhone/iPad
 * không lộ đời máy. Máy ĐANG dùng thì lấy được model chính xác qua User-Agent Client Hints
 * (`navigator.userAgentData`), dùng cho nút "Duyệt thiết bị của tôi". Thiết bị LẠ đang chờ duyệt chỉ có
 * User-Agent đã rút gọn trên Server, nên hiện trình duyệt + hệ điều hành (+ model nếu UA còn lộ).
 */

/** Tên thương mại theo 7 ký tự đầu của mã máy Samsung (ký tự cuối là vùng bán, bỏ qua). */
const SAMSUNG: Record<string, string> = {
  'SM-S938': 'Galaxy S25 Ultra',
  'SM-S936': 'Galaxy S25+',
  'SM-S931': 'Galaxy S25',
  'SM-S928': 'Galaxy S24 Ultra',
  'SM-S926': 'Galaxy S24+',
  'SM-S921': 'Galaxy S24',
  'SM-S918': 'Galaxy S23 Ultra',
  'SM-S916': 'Galaxy S23+',
  'SM-S911': 'Galaxy S23',
  'SM-S908': 'Galaxy S22 Ultra',
  'SM-S906': 'Galaxy S22+',
  'SM-S901': 'Galaxy S22',
  'SM-G998': 'Galaxy S21 Ultra',
  'SM-N986': 'Galaxy Note20 Ultra',
  'SM-F956': 'Galaxy Z Fold6',
  'SM-F946': 'Galaxy Z Fold5',
  'SM-F741': 'Galaxy Z Flip6',
  'SM-F731': 'Galaxy Z Flip5',
  'SM-A546': 'Galaxy A54',
}

/** Mã máy -> tên dễ đọc; mã lạ giữ nguyên (vẫn rõ hơn chữ "Android"). Rỗng nếu chỉ là mã rút gọn. */
export function friendlyModel(raw: string): string {
  const model = raw.trim()
  // UA rút gọn của Chrome Android dùng "K" (hoặc "Mobile") thay cho model thật.
  if (model === '' || model === 'K' || model === 'Mobile' || model === 'Android') return ''
  const known = SAMSUNG[model.slice(0, 7).toUpperCase()]
  return known ?? model
}

export type UaInfo = { browser: string; os: string; model: string }

const first = (re: RegExp, ua: string) => re.exec(ua)?.[1]

/** Đọc trình duyệt, hệ điều hành và (nếu còn lộ) model từ chuỗi User-Agent. */
export function parseUa(ua: string): UaInfo {
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /SamsungBrowser\//.test(ua)
      ? 'Samsung Internet'
      : /OPR\/|Opera/.test(ua)
        ? 'Opera'
        : /Firefox\/|FxiOS\//.test(ua)
          ? 'Firefox'
          : /Chrome\/|CriOS\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : ''
  const android = first(/Android ([\d.]+)/, ua)
  const ios = first(/OS (\d+)[_\d]* like Mac OS X/, ua)
  const os = android
    ? `Android ${android.split('.')[0]}`
    : /iPhone/.test(ua)
      ? `iOS${ios ? ` ${ios}` : ''}`
      : /iPad/.test(ua)
        ? `iPadOS${ios ? ` ${ios}` : ''}`
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS X/.test(ua)
            ? 'macOS'
            : /CrOS/.test(ua)
              ? 'ChromeOS'
              : /Linux/.test(ua)
                ? 'Linux'
                : ''
  const rawModel = android
    ? (first(/Android [\d.]+; ([^;)]+?)(?: Build\/[^;)]*)?[;)]/, ua) ?? '')
    : ''
  const model = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : friendlyModel(rawModel)
  return { browser, os, model }
}

/** Nhãn ngắn từ User-Agent: "Galaxy S23 Ultra · Chrome · Android 14" (bỏ phần trống). */
export function describeUa(ua: string): string {
  const { browser, os, model } = parseUa(ua)
  return [model, browser, os].filter(Boolean).join(' · ') || ua.slice(0, 40)
}

/** Gắn tên người dùng: "Galaxy S23 Ultra của Tuấn". Không có tên thì giữ nguyên mô tả. */
export function withOwner(description: string, owner: string | undefined): string {
  const name = owner?.trim()
  return name ? `${description} của ${name}`.slice(0, 64) : description.slice(0, 64)
}

type UaData = {
  mobile?: boolean
  platform?: string
  brands?: { brand: string; version: string }[]
  getHighEntropyValues?: (hints: string[]) => Promise<Record<string, unknown>>
}

/**
 * Tên CHÍNH XÁC của máy đang dùng, qua User-Agent Client Hints (chỉ Chromium; Firefox/Safari không có thì
 * rơi về User-Agent). Chạy ngay trên máy người dùng nên có cả model thật mà Server không thấy được.
 */
export async function detectOwnDevice(): Promise<string> {
  const fallback = describeUa(typeof navigator === 'undefined' ? '' : navigator.userAgent)
  const data = (navigator as Navigator & { userAgentData?: UaData }).userAgentData
  if (!data?.getHighEntropyValues) return fallback
  try {
    const v = await data.getHighEntropyValues(['model', 'platformVersion', 'platform'])
    const model = friendlyModel(typeof v.model === 'string' ? v.model : '')
    const platform = typeof v.platform === 'string' ? v.platform : (data.platform ?? '')
    const major = typeof v.platformVersion === 'string' ? v.platformVersion.split('.')[0] : ''
    const ua = parseUa(navigator.userAgent)
    // Windows 11 báo platformVersion >= 13; "10.0" là Windows 10.
    const os =
      platform === 'Windows'
        ? Number(major) >= 13
          ? 'Windows 11'
          : 'Windows 10'
        : platform === 'Android' && major
          ? `Android ${major}`
          : ua.os
    const label = [model || ua.model, ua.browser, os].filter(Boolean).join(' · ')
    return label || fallback
  } catch {
    return fallback
  }
}

/** Tên máy đang dùng; có ngay bản từ UA, rồi nâng cấp khi Client Hints trả về. */
export function useOwnDevice(): string {
  const [name, setName] = useState(() =>
    describeUa(typeof navigator === 'undefined' ? '' : navigator.userAgent),
  )
  useEffect(() => {
    let alive = true
    void detectOwnDevice().then((n) => alive && setName(n))
    return () => {
      alive = false
    }
  }, [])
  return name
}
