import { createHmac, timingSafeEqual } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'
import {
  EDGE_IP_HEADER,
  EDGE_MAX_SKEW_SEC,
  EDGE_SIG_HEADER,
  EDGE_TS_HEADER,
  edgeMessage,
} from '@az-sentinel/shared'

const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v)

/**
 * IP thật của người dùng khi request đi qua Worker của mình (Plan 3G). Chỉ tin khi chữ ký HMAC (khóa =
 * `SYNC_TOKEN`) khớp và mốc giờ không lệch quá 5 phút; header thiếu, sai chữ ký hay hết hạn thì trả null và
 * VPS dùng cách xác định IP bình thường. Nhờ vậy người ngoài không giả được IP để qua mặt whitelist.
 */
export function verifyEdgeClientIp(
  secret: string,
  headers: IncomingHttpHeaders,
  nowSec: number = Math.floor(Date.now() / 1000),
): string | null {
  if (secret === '') return null
  const ip = one(headers[EDGE_IP_HEADER.toLowerCase()])?.trim()
  const ts = Number(one(headers[EDGE_TS_HEADER.toLowerCase()]))
  const sig = one(headers[EDGE_SIG_HEADER.toLowerCase()])?.trim().toLowerCase()
  if (!ip || !sig || !Number.isInteger(ts) || Math.abs(nowSec - ts) > EDGE_MAX_SKEW_SEC) return null
  if (!/^[0-9a-f]{64}$/.test(sig)) return null
  const expected = createHmac('sha256', secret).update(edgeMessage(ip, ts)).digest()
  const given = Buffer.from(sig, 'hex')
  return given.length === expected.length && timingSafeEqual(given, expected) ? ip : null
}

/** Ba header của Plan 3G, dùng để gỡ khỏi request trước khi chuyển cho BE. */
export const EDGE_HEADERS = [EDGE_IP_HEADER, EDGE_TS_HEADER, EDGE_SIG_HEADER]
