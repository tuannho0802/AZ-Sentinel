import { strings } from './strings'

/** Trang tải bộ cài AZ Gateway (GitHub Releases của dự án). */
export const GATEWAY_DOWNLOAD_URL = 'https://github.com/tuannho0802/AZ-Sentinel/releases'

/** Lời mời gửi cho người dùng: 3 bước + mã kết nối, dùng địa chỉ trang web hiện tại làm nơi đăng nhập. */
export function buildInvite(code: string, webUrl: string = window.location.origin): string {
  return strings.inviteMessage(code, webUrl, GATEWAY_DOWNLOAD_URL)
}
