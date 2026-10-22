import { decodeConnectCode } from '@az-sentinel/shared'
import {
  CHECK_BAD_INPUT,
  CHECK_INVALID,
  CHECK_OK,
  CHECK_UNREACHABLE,
  checkGatewayToken,
} from './check-token'
import { writeConnection } from './config'

/**
 * Lệnh cho bộ cài: `az-gateway.exe check-code <mã>` và `az-gateway.exe apply-code <mã> [tên-vps]`.
 * Mã thoát của `check-code` giống `check-token` (0 hợp lệ, 1 bị từ chối, 2 không hỏi được cloud, 3 mã sai);
 * bộ cài dựa vào các số này. Không bao giờ in token hay mã ra output.
 */
export async function runCheckCode(
  args: string[],
  out: (line: string) => void = console.log,
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  const p = decodeConnectCode(args[0] ?? '')
  if (!p) {
    out('Mã kết nối không đúng. Hãy dán lại nguyên mã azc1... do quản trị viên gửi')
    return CHECK_BAD_INPUT
  }
  const first = await checkGatewayToken(p.primaryUrl, p.token, fetchImpl)
  if (first.code === CHECK_OK || first.code === CHECK_INVALID) {
    out(first.message)
    return first.code
  }
  // VPS chính không đáp: thử địa chỉ dự phòng trước khi kết luận là không hỏi được.
  if (p.fallbackUrl !== '') {
    const second = await checkGatewayToken(p.fallbackUrl, p.token, fetchImpl)
    if (second.code === CHECK_OK || second.code === CHECK_INVALID) {
      out(second.message)
      return second.code
    }
  }
  out(first.message)
  return CHECK_UNREACHABLE
}

export function runApplyCode(args: string[], out: (line: string) => void = console.log): number {
  const p = decodeConnectCode(args[0] ?? '')
  if (!p) {
    out('Mã kết nối không đúng')
    return CHECK_BAD_INPUT
  }
  const vps = (args[1] ?? '').trim().slice(0, 64)
  writeConnection({ ...p, ...(vps !== '' ? { vps } : {}) })
  out('Đã lưu cấu hình kết nối')
  return CHECK_OK
}
