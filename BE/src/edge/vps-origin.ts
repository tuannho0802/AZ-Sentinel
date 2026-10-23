import { normalizeTunnelOrigin } from '@az-sentinel/shared'
import type { Bindings } from '../types'
import { normalizeOrigin } from './vps-probe'

const TUNNEL_ORIGIN_KEY = 'vps_tunnel_origin'
const CACHE_MS = 10_000

type Entry = { origin: string | null; at: number }

/**
 * Plan 3G: địa chỉ VPS mà Worker chuyển tiếp tới. Khi VPS dùng Quick Tunnel (địa chỉ đổi mỗi lần chạy lại),
 * VPS tự báo địa chỉ mới qua nhịp sống và Worker lưu trong D1; địa chỉ đó thắng `VPS_ORIGIN` cấu hình tay.
 * Đọc D1 có đệm 10 giây trong mỗi isolate, và ghi nhịp sống cập nhật đệm ngay nên không phải chờ.
 */
export class VpsOriginStore {
  private entry: Entry | null = null

  constructor(private readonly now: () => number = Date.now) {}

  /** Cập nhật đệm ngay sau khi nhận địa chỉ mới (cùng isolate). */
  remember(origin: string | null): void {
    this.entry = { origin, at: this.now() }
  }

  forget(): void {
    this.entry = null
  }

  /** Địa chỉ tunnel VPS đã báo lên (không tính `VPS_ORIGIN` cấu hình tay); null nếu chưa có. */
  async learned(env: Pick<Bindings, 'DB'>): Promise<string | null> {
    const cached = this.entry
    if (cached && this.now() - cached.at < CACHE_MS) return cached.origin
    try {
      const row = await env.DB.prepare('SELECT v FROM server_meta WHERE k = ?')
        .bind(TUNNEL_ORIGIN_KEY)
        .first<{ v: string }>()
      const origin = normalizeTunnelOrigin(row?.v)
      this.entry = { origin, at: this.now() }
      return origin
    } catch {
      // D1 lỗi tạm thời: dùng giá trị đã nhớ (kể cả cũ).
      return cached?.origin ?? null
    }
  }

  async resolve(env: Pick<Bindings, 'DB' | 'VPS_ORIGIN'>): Promise<string | null> {
    return (await this.learned(env)) ?? normalizeOrigin(env.VPS_ORIGIN)
  }
}

/** Một bản dùng chung cho cả isolate. Test truyền bản riêng để không nhiễu nhau. */
export const sharedOriginStore = new VpsOriginStore()

/** Ghi (hoặc xóa khi `origin` là null) địa chỉ tunnel VPS đã báo. */
export async function saveTunnelOrigin(
  db: D1Database,
  origin: string | null,
  nowSec: number,
  store: VpsOriginStore = sharedOriginStore,
): Promise<void> {
  if (origin === null) {
    await db.prepare('DELETE FROM server_meta WHERE k = ?').bind(TUNNEL_ORIGIN_KEY).run()
  } else {
    await db
      .prepare(
        `INSERT INTO server_meta (k, v, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at
         WHERE server_meta.v != excluded.v`,
      )
      .bind(TUNNEL_ORIGIN_KEY, origin, nowSec)
      .run()
  }
  store.remember(origin)
}
