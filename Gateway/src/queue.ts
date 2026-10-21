import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { type EventRequest, GW } from '@az-sentinel/shared'

/** Một lô sự kiện chờ gửi lên cloud. `seq` do Gateway cấp, đơn điệu theo từng terminal. */
export type QueuedEvent = {
  tid: string
  seq: number
  reason: EventRequest['reason']
  events: EventRequest['events']
  snap?: EventRequest['snap']
}

const MAX_FILE_BYTES = 1_000_000

/**
 * Hàng đợi sự kiện trong bộ nhớ, tùy chọn ghi ra một file nhỏ để sống sót qua khởi động lại
 * Gateway (Plan 3C Q7). Không chứa mẫu live. Ghi bất đồng bộ có điều tiết, thay file nguyên tử.
 */
export class EventQueue {
  private items: QueuedEvent[] = []
  private timer: NodeJS.Timeout | null = null
  /** Số lô bị bỏ vì hàng đợi đầy. */
  dropped = 0

  constructor(private readonly file: string | null = null) {
    if (file) this.load(file)
  }

  get length(): number {
    return this.items.length
  }

  all(): readonly QueuedEvent[] {
    return this.items
  }

  forTerminal(tid: string): QueuedEvent[] {
    return this.items.filter((i) => i.tid === tid)
  }

  push(item: QueuedEvent): void {
    this.items.push(item)
    while (this.items.length > GW.maxQueue) {
      this.items.shift()
      this.dropped++
    }
    this.schedule()
  }

  /** Bỏ lô đã được cloud xác nhận. Trả về số lô bị bỏ. */
  ack(tid: string, seq: number): number {
    const before = this.items.length
    this.items = this.items.filter((i) => !(i.tid === tid && i.seq === seq))
    if (this.items.length !== before) this.schedule()
    return before - this.items.length
  }

  /** Bỏ mọi lô của terminal (khóa bị từ chối). */
  dropTerminal(tid: string): number {
    const before = this.items.length
    this.items = this.items.filter((i) => i.tid !== tid)
    if (this.items.length !== before) this.schedule()
    return before - this.items.length
  }

  /** Ghi ngay (dùng khi tắt Gateway và trong test). */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (!this.file) return
    let data = JSON.stringify(this.items)
    // Giữ file dưới 1 MB: bỏ lô cũ nhất cho đến khi vừa.
    while (Buffer.byteLength(data) > MAX_FILE_BYTES && this.items.length > 0) {
      this.items.shift()
      this.dropped++
      data = JSON.stringify(this.items)
    }
    mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, data)
    renameSync(tmp, this.file)
  }

  private schedule(): void {
    if (!this.file || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      try {
        this.flush()
      } catch {
        // Lỗi đĩa không được làm sập Gateway; hàng đợi vẫn còn trong bộ nhớ.
      }
    }, 200)
    this.timer.unref()
  }

  private load(file: string): void {
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
      if (Array.isArray(parsed)) {
        this.items = parsed.filter(
          (i): i is QueuedEvent =>
            typeof i === 'object' &&
            i !== null &&
            typeof i.tid === 'string' &&
            typeof i.seq === 'number' &&
            Array.isArray(i.events),
        )
      }
    } catch {
      // Không có file hoặc file hỏng: bắt đầu với hàng đợi rỗng.
    }
  }
}
