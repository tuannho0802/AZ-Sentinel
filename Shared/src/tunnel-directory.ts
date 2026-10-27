/**
 * Plan 3H: Worker Cloudflare là "danh bạ tunnel" cho Gateway. VPS (Quick Tunnel) báo địa chỉ hiện tại cho Worker,
 * Gateway hỏi Worker một request nhỏ khi mất kết nối rồi nối THẲNG vào tunnel, nên lưu lượng thật không đi
 * qua Worker và không tốn hạn mức request.
 */
export const GW_TUNNEL_PATH = '/api/gw/tunnel'

export type TunnelDirectoryReply = {
  ok: true
  /** Địa chỉ tunnel hiện tại của VPS (`https://xxxx.trycloudflare.com`), null nếu Worker chưa biết. */
  origin: string | null
  /** Địa chỉ WebSocket Gateway tương ứng (`wss://.../api/gw/ws`), null nếu `origin` null. */
  wsUrl: string | null
}

/** `wss://host/x` hoặc `https://host/x` -> `https://host/api/gw/tunnel`; null nếu không phải ws(s)/http(s). */
export function tunnelDirectoryUrl(url: string): string | null {
  try {
    const u = new URL(url)
    const proto = { 'ws:': 'http:', 'wss:': 'https:', 'http:': 'http:', 'https:': 'https:' }[
      u.protocol
    ]
    if (!proto) return null
    return `${proto}//${u.host}${GW_TUNNEL_PATH}`
  } catch {
    return null
  }
}

/** `https://host` -> `wss://host/api/gw/ws`. */
export function tunnelWsUrl(origin: string): string {
  return `${origin.replace(/^http/i, 'ws')}/api/gw/ws`
}

/**
 * Plan 3J: Worker chuyển hướng (302) lượt tải trang sang Quick Tunnel đang sống để mọi request sau đó đi THẲNG vào VPS,
 * không tốn hạn mức Worker. Thêm tham số này vào địa chỉ Worker để ở lại bản dự phòng (không chuyển hướng); giao diện
 * dùng nó khi tự chuyển từ tunnel chết sang Worker, tránh bị đẩy ngược về tunnel chết do kết quả dò còn nhớ tạm.
 */
export const PAGE_STAY_PARAM = 'az_stay'
