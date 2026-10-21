/** Địa chỉ Gateway cục bộ mà EA gọi (mặc định InpGateway); phải nằm trong Allow WebRequest của MT5. */
export const GATEWAY_LOCAL_URL = 'http://127.0.0.1:47800'

/**
 * Địa chỉ cloud mà Gateway nối tới (cấu hình `cloudUrl` hoặc biến AZ_GW_CLOUD_URL).
 * Ở dev, BE chạy cổng 8787 (khác cổng FE 5173); ở bản deploy dùng cùng host với trang web.
 */
export function gatewayCloudUrl(): string {
  if (import.meta.env.DEV) return 'ws://127.0.0.1:8787/api/gw/ws'
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}/api/gw/ws`
}
