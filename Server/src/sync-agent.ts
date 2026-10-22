import {
  FAILOVER,
  type ServerNode,
  type StandbyStatus,
  type SyncApply,
  type SyncLinkRow,
  type SyncTradeRow,
  syncLinksPageSchema,
  syncTradesPageSchema,
} from '@az-sentinel/shared'
import { LINK_COLS, TRADE_COLS } from '../../BE/src/services/sync-service'
import type { Logger } from './log'
import type { ShimD1 } from './shim/d1'

type OutboxRow = { seq: number; kind: 'link' | 'trade'; a: number; b: number }
type Reply = { ok: boolean; status: number; json: unknown }

const placeholders = (n: number) => Array(n).fill('?').join(', ')
const nowSec = () => Math.floor(Date.now() / 1000)
const NUDGE_MIN_GAP_SEC = 300

const LINK_INSERT = `INSERT OR IGNORE INTO ea_links (${LINK_COLS.join(', ')}) VALUES (${placeholders(LINK_COLS.length)})`
const TRADE_UPSERT = `INSERT INTO trades (${TRADE_COLS.join(', ')}) VALUES (${placeholders(TRADE_COLS.length)})
  ON CONFLICT(link_id, ticket) DO UPDATE SET ${TRADE_COLS.filter(
    (c) => c !== 'link_id' && c !== 'ticket',
  )
    .map((c) => `${c} = excluded.${c}`)
    .join(', ')}
  WHERE trades.close_time IS NULL AND excluded.close_time IS NOT NULL`

export type SyncAgentOptions = {
  cloudOrigin: string
  token: string
  describe: () => ServerNode
  log: Logger
  fetchFn?: typeof fetch
}

/**
 * Đồng bộ VPS <-> Cloudflare (Plan 3E).
 * - Đẩy: trigger SQLite ghi `sync_outbox` mỗi khi `ea_links`/`trades` đổi; agent gom tối đa
 *   `FAILOVER.syncBatch` dòng mỗi lần, đọc lại nội dung hiện tại rồi `POST /api/sync/apply` (upsert nên
 *   gửi lại an toàn). Lỗi tạm thời: giữ nguyên hàng đợi, thử lại sau. Dòng bị Cloudflare từ chối
 *   (400/413) bị bỏ riêng từng dòng để không kẹt cả hàng đợi.
 * - Kéo: khởi động lần đầu nhận toàn bộ liên kết và lệnh của Cloudflare (dữ liệu cũ trước khi có VPS);
 *   sau đó định kỳ và khi có Gateway nối lại, kéo các lệnh Cloudflare đã ghi lúc dự phòng. Áp dụng
 *   không đẩy ngược (trigger bị tắt) và không ghi đè bản VPS đã đóng lệnh.
 * - Nhịp sống: báo thông tin máy lên Cloudflare để UI dự phòng còn hiện VPS lần cuối.
 */
export class SyncAgent {
  private lastSyncAt: number | null = null
  private lastError: string | null = null
  private flushing = false
  private pulling = false
  private lastPullAt = 0
  private timers: NodeJS.Timeout[] = []
  private readonly fetchFn: typeof fetch

  constructor(
    private readonly store: ShimD1,
    private readonly opts: SyncAgentOptions,
  ) {
    this.fetchFn = opts.fetchFn ?? fetch
  }

  status(): StandbyStatus {
    const row = this.store.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_outbox').get() as {
      n: number
    }
    return {
      configured: true,
      lastSyncAt: this.lastSyncAt,
      pending: Number(row.n),
      lastError: this.lastError,
    }
  }

  start(): void {
    const every = (fn: () => Promise<void>, sec: number) => {
      const t = setInterval(() => void fn().catch(() => {}), sec * 1000)
      t.unref()
      this.timers.push(t)
    }
    void this.boot()
    every(() => this.flush(), FAILOVER.syncFlushSec)
    every(() => this.heartbeat(), FAILOVER.heartbeatSec)
    every(() => this.pull(), FAILOVER.pullSec)
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t)
    this.timers = []
  }

  /** Gọi khi có Gateway nối vào: VPS vừa (có thể) quay lại, kéo sớm các lệnh Cloudflare ghi hộ. */
  nudgePull(): void {
    if (nowSec() - this.lastPullAt >= NUDGE_MIN_GAP_SEC) void this.pull().catch(() => {})
  }

  // ------------------------------------------------------------------ khởi động

  private async boot(): Promise<void> {
    await this.heartbeat()
    if (this.getState('bootstrap') !== 'done') {
      const ok = await this.bootstrap()
      if (!ok) {
        this.log(
          'warn',
          'chưa nhận được dữ liệu ban đầu từ Cloudflare, sẽ thử lại ở nhịp kéo kế tiếp',
        )
      }
    } else {
      await this.pull()
    }
    await this.flush()
  }

  /** Lần đầu: nhận dữ liệu cũ của Cloudflare; nếu VPS đã có dữ liệu riêng thì đẩy hết sang Cloudflare. */
  private async bootstrap(): Promise<boolean> {
    const localHadData =
      Number(
        (this.store.sqlite.prepare('SELECT COUNT(*) AS n FROM ea_links').get() as { n: number }).n,
      ) > 0
    const startedAt = nowSec()
    let after = 0
    for (;;) {
      const reply = await this.get(`/api/sync/links?after=${after}&limit=100`)
      if (!reply.ok) return false
      const page = syncLinksPageSchema.safeParse(reply.json)
      if (!page.success) return this.fail('phản hồi /sync/links không hợp lệ')
      this.applyMuted(() => {
        const stmt = this.store.statement(LINK_INSERT)
        for (const row of page.data.links) stmt.run(...LINK_COLS.map((c) => row[c]))
      })
      if (page.data.next === null) break
      after = page.data.next
    }
    if (!(await this.pullTrades(0))) return false
    if (localHadData) this.enqueueAll()
    this.setState('bootstrap', 'done')
    this.setState('last_pull_at', String(startedAt))
    this.lastPullAt = startedAt
    this.log('info', 'đã nhận dữ liệu ban đầu từ Cloudflare')
    return true
  }

  private enqueueAll(): void {
    this.store.sqlite.exec(`
      INSERT OR REPLACE INTO sync_outbox (kind, a, b) SELECT 'link', id, 0 FROM ea_links;
      INSERT OR REPLACE INTO sync_outbox (kind, a, b) SELECT 'trade', link_id, ticket FROM trades;
    `)
  }

  // ------------------------------------------------------------------ đẩy

  async heartbeat(): Promise<void> {
    await this.post('/api/sync/heartbeat', { node: this.opts.describe(), sentAt: nowSec() })
  }

  async flush(): Promise<void> {
    if (this.flushing) return
    this.flushing = true
    try {
      for (let i = 0; i < 400; i++) {
        const rows = this.store.sqlite
          .prepare('SELECT seq, kind, a, b FROM sync_outbox ORDER BY seq LIMIT ?')
          .all(FAILOVER.syncBatch) as OutboxRow[]
        if (rows.length === 0) break
        if (!(await this.push(rows))) break
      }
    } finally {
      this.flushing = false
    }
  }

  /** Đẩy một nhóm dòng. true = có tiến triển (đã gửi hoặc đã bỏ dòng hỏng); false = lỗi tạm thời. */
  private async push(rows: OutboxRow[]): Promise<boolean> {
    const reply = await this.post('/api/sync/apply', this.buildPayload(rows))
    if (reply.ok) {
      this.ack(rows)
      this.lastSyncAt = nowSec()
      this.lastError = null
      return true
    }
    if (reply.status === 400 || reply.status === 413) {
      if (rows.length > 1) {
        const mid = Math.ceil(rows.length / 2)
        return (await this.push(rows.slice(0, mid))) && (await this.push(rows.slice(mid)))
      }
      const only = rows[0]
      this.log(
        'error',
        `Cloudflare từ chối ${only?.kind} ${only?.a}/${only?.b} (HTTP ${reply.status}), bỏ qua`,
      )
      this.ack(rows)
      this.lastError = `đã bỏ một thay đổi bị từ chối (HTTP ${reply.status})`
      return true
    }
    return false
  }

  private buildPayload(rows: OutboxRow[]): SyncApply {
    const payload: SyncApply = { links: [], links_deleted: [], trades: [], trades_deleted: [] }
    const link = this.store.statement(`SELECT ${LINK_COLS.join(', ')} FROM ea_links WHERE id = ?`)
    const trade = this.store.statement(
      `SELECT ${TRADE_COLS.join(', ')} FROM trades WHERE link_id = ? AND ticket = ?`,
    )
    for (const r of rows) {
      if (r.kind === 'link') {
        const row = link.get(r.a)
        if (row) payload.links.push({ ...row } as SyncLinkRow)
        else payload.links_deleted.push(r.a)
      } else {
        const row = trade.get(r.a, r.b)
        if (row) payload.trades.push({ ...row } as SyncTradeRow)
        else payload.trades_deleted.push({ link_id: r.a, ticket: r.b })
      }
    }
    return payload
  }

  /** Xóa khỏi hàng đợi đúng các dòng đã gửi (dòng bị thay bằng seq mới trong lúc gửi thì giữ lại). */
  private ack(rows: OutboxRow[]): void {
    const del = this.store.statement('DELETE FROM sync_outbox WHERE seq = ?')
    for (const r of rows) del.run(r.seq)
  }

  // ------------------------------------------------------------------ kéo

  async pull(): Promise<void> {
    if (this.pulling || this.getState('bootstrap') !== 'done') {
      if (this.getState('bootstrap') !== 'done' && !this.pulling) {
        this.pulling = true
        try {
          await this.bootstrap()
        } finally {
          this.pulling = false
        }
      }
      return
    }
    this.pulling = true
    try {
      const startedAt = nowSec()
      const since = Math.max(
        0,
        Number(this.getState('last_pull_at') ?? 0) - FAILOVER.pullOverlapSec,
      )
      if (await this.pullTrades(since)) {
        this.setState('last_pull_at', String(startedAt))
        this.lastPullAt = startedAt
      }
    } finally {
      this.pulling = false
    }
  }

  private async pullTrades(since: number): Promise<boolean> {
    let link = 0
    let ticket = 0
    for (;;) {
      const reply = await this.get(
        `/api/sync/trades?since=${since}&after_link=${link}&after_ticket=${ticket}&limit=100`,
      )
      if (!reply.ok) return false
      const page = syncTradesPageSchema.safeParse(reply.json)
      if (!page.success) return this.fail('phản hồi /sync/trades không hợp lệ')
      this.applyMuted(() => {
        const stmt = this.store.statement(TRADE_UPSERT)
        for (const row of page.data.trades) stmt.run(...TRADE_COLS.map((c) => row[c]))
      })
      if (page.data.next === null) return true
      link = page.data.next.link_id
      ticket = page.data.next.ticket
    }
  }

  /** Áp dữ liệu kéo về trong một giao dịch với trigger outbox bị tắt (chạy đồng bộ, không bị xen ngang). */
  private applyMuted(fn: () => void): void {
    const db = this.store.sqlite
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec("UPDATE sync_state SET v = '1' WHERE k = 'mute'")
      fn()
      db.exec("UPDATE sync_state SET v = '0' WHERE k = 'mute'")
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  // ------------------------------------------------------------------ HTTP và tiện ích

  private async request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Reply> {
    try {
      const res = await this.fetchFn(`${this.opts.cloudOrigin}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.opts.token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      })
      let json: unknown = null
      try {
        json = await res.json()
      } catch {
        // phản hồi không phải JSON
      }
      if (!res.ok) this.lastError = `Cloudflare trả HTTP ${res.status}`
      return { ok: res.ok, status: res.status, json }
    } catch (error) {
      this.lastError =
        `không tới được Cloudflare: ${error instanceof Error ? error.message : String(error)}`.slice(
          0,
          200,
        )
      return { ok: false, status: 0, json: null }
    }
  }

  private get(path: string): Promise<Reply> {
    return this.request('GET', path)
  }

  private post(path: string, body: unknown): Promise<Reply> {
    return this.request('POST', path, body)
  }

  private fail(message: string): false {
    this.lastError = message
    this.log('warn', message)
    return false
  }

  private getState(key: string): string | undefined {
    const row = this.store.sqlite.prepare('SELECT v FROM sync_state WHERE k = ?').get(key) as
      | { v: string }
      | undefined
    return row?.v
  }

  private setState(key: string, value: string): void {
    this.store.sqlite
      .prepare(
        'INSERT INTO sync_state (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v',
      )
      .run(key, value)
  }

  private log(level: 'info' | 'warn' | 'error', msg: string): void {
    this.opts.log[level](`sync: ${msg}`)
  }
}
