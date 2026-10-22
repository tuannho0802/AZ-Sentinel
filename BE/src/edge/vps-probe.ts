import { FAILOVER, SERVED_BY_HEADER } from '@az-sentinel/shared'
import { type FetchFn, realFetch, timedFetch } from './timed-fetch'

export type ProbeSnapshot = {
  up: boolean | null
  checkedAt: number | null
  /** Unix giây lần cuối thấy VPS sống (dò hoặc chuyển tiếp thành công). */
  lastUpAt: number | null
  /** Unix giây lúc bắt đầu sập; null khi đang sống hoặc chưa biết. */
  downSince: number | null
}

/**
 * Trạng thái "VPS có sống không" mà Worker nhớ tạm. Mỗi isolate giữ một bản; dò thưa khi sống
 * (`probeOkTtlMs`) và dày khi sập (`probeDownTtlMs`) để quay về VPS sớm. Nhiều request đồng thời
 * dùng chung một lần dò đang chạy. Chuyển tiếp thất bại gọi `markDown()` để request sau đi dự phòng
 * ngay, không phải chờ hết hạn nhớ tạm.
 */
export class VpsProbe {
  private up: boolean | null = null
  private checkedAt = 0
  private lastUpAt: number | null = null
  private downSince: number | null = null
  private inflight: Promise<boolean> | null = null

  constructor(
    readonly origin: string,
    private readonly fetchFn: FetchFn = realFetch,
    private readonly now: () => number = Date.now,
  ) {}

  async isUp(): Promise<boolean> {
    const age = this.now() - this.checkedAt
    if (this.up !== null && age < (this.up ? FAILOVER.probeOkTtlMs : FAILOVER.probeDownTtlMs)) {
      return this.up
    }
    this.inflight ??= this.check().finally(() => {
      this.inflight = null
    })
    return this.inflight
  }

  markDown(): void {
    this.record(false)
  }

  markUp(): void {
    this.record(true)
  }

  snapshot(): ProbeSnapshot {
    return {
      up: this.up,
      checkedAt: this.up === null ? null : Math.floor(this.checkedAt / 1000),
      lastUpAt: this.lastUpAt,
      downSince: this.downSince,
    }
  }

  private async check(): Promise<boolean> {
    let ok = false
    try {
      const res = await timedFetch(
        this.fetchFn,
        `${this.origin}/api/health`,
        { method: 'GET', headers: { Accept: 'application/json' } },
        FAILOVER.probeTimeoutMs,
      )
      // Phải đúng máy chủ VPS của mình (header vai trò) chứ không phải trang lỗi của tunnel/proxy.
      if (res.ok && res.headers.get(SERVED_BY_HEADER) === 'vps') {
        const body = (await res.json()) as { status?: unknown }
        ok = body.status === 'ok'
      } else {
        await res.body?.cancel()
      }
    } catch {
      ok = false
    }
    this.record(ok)
    return ok
  }

  private record(up: boolean): void {
    const t = this.now()
    this.checkedAt = t
    if (up) {
      this.lastUpAt = Math.floor(t / 1000)
      this.downSince = null
    } else if (this.up !== false) {
      this.downSince = Math.floor(t / 1000)
    }
    this.up = up
  }
}

export type ProbeRegistry = Map<string, VpsProbe>

const shared: ProbeRegistry = new Map()

/** Một `VpsProbe` cho mỗi origin trong cả isolate. Test truyền `registry` riêng để không nhiễu nhau. */
export function probeFor(
  origin: string,
  registry: ProbeRegistry = shared,
  fetchFn?: FetchFn,
): VpsProbe {
  let probe = registry.get(origin)
  if (!probe) {
    probe = new VpsProbe(origin, fetchFn)
    registry.set(origin, probe)
  }
  return probe
}

/** Chuẩn hóa `VPS_ORIGIN`: chỉ nhận http(s), bỏ dấu `/` cuối và mọi đường dẫn. Sai định dạng trả null. */
export function normalizeOrigin(raw: string | undefined): string | null {
  const text = (raw ?? '').trim()
  if (text === '') return null
  try {
    const url = new URL(text)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url.origin
  } catch {
    return null
  }
}
