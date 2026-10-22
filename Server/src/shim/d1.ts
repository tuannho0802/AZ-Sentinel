import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite'

/**
 * Lớp tương thích D1 trên `node:sqlite` (Plan 3E): đủ `prepare().bind().first/all/run/raw` và `batch`
 * (nguyên tử) mà BE dùng. Câu lệnh chạy đồng bộ nên một `batch` không bị xen ngang.
 */

type Meta = {
  changes: number
  rows_read: number
  rows_written: number
  last_row_id: number
  duration: number
}
type Result<T> = { success: true; results: T[]; meta: Meta }

function toParam(v: unknown): SQLInputValue {
  if (v === undefined || v === null) return null
  if (typeof v === 'boolean') return v ? 1 : 0
  return v as SQLInputValue
}

const plain = <T>(row: unknown): T => ({ ...(row as object) }) as T

export class ShimStatement {
  constructor(
    private readonly db: ShimD1,
    readonly sql: string,
    private readonly params: SQLInputValue[] = [],
  ) {}

  bind(...values: unknown[]): ShimStatement {
    return new ShimStatement(this.db, this.sql, values.map(toParam))
  }

  /** Chạy một lần, trả kết quả theo dạng D1. */
  execute<T = Record<string, unknown>>(): Result<T> {
    const started = performance.now()
    const stmt: StatementSync = this.db.statement(this.sql)
    if (stmt.columns().length > 0) {
      const rows = stmt.all(...this.params).map((r) => plain<T>(r))
      return {
        success: true,
        results: rows,
        meta: {
          changes: 0,
          rows_read: rows.length,
          rows_written: 0,
          last_row_id: 0,
          duration: performance.now() - started,
        },
      }
    }
    const r = stmt.run(...this.params)
    const changes = Number(r.changes)
    return {
      success: true,
      results: [],
      meta: {
        changes,
        rows_read: 0,
        rows_written: changes,
        last_row_id: Number(r.lastInsertRowid),
        duration: performance.now() - started,
      },
    }
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = this.execute<Record<string, unknown>>().results[0]
    if (!row) return null
    return (column === undefined ? row : row[column]) as T
  }

  async all<T = Record<string, unknown>>(): Promise<Result<T>> {
    return this.execute<T>()
  }

  async run<T = Record<string, unknown>>(): Promise<Result<T>> {
    return this.execute<T>()
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    return this.execute().results.map((r) => Object.values(r)) as T[]
  }
}

export class ShimD1 {
  private readonly cache = new Map<string, StatementSync>()

  constructor(readonly sqlite: DatabaseSync) {}

  statement(sql: string): StatementSync {
    let stmt = this.cache.get(sql)
    if (!stmt) {
      if (this.cache.size > 500) this.cache.clear()
      stmt = this.sqlite.prepare(sql)
      this.cache.set(sql, stmt)
    }
    return stmt
  }

  prepare(sql: string): ShimStatement {
    return new ShimStatement(this, sql)
  }

  /** Mọi câu lệnh trong một giao dịch: lỗi thì hoàn tác tất cả (giống D1). */
  async batch<T = Record<string, unknown>>(statements: ShimStatement[]): Promise<Result<T>[]> {
    this.sqlite.exec('BEGIN IMMEDIATE')
    try {
      const results = statements.map((s) => s.execute<T>())
      this.sqlite.exec('COMMIT')
      return results
    } catch (error) {
      try {
        this.sqlite.exec('ROLLBACK')
      } catch {
        // giao dịch đã tự hủy
      }
      throw error
    }
  }

  async exec(sql: string): Promise<{ count: number; duration: number }> {
    this.sqlite.exec(sql)
    return { count: 1, duration: 0 }
  }
}

/** Mở (tạo nếu chưa có) CSDL SQLite ở chế độ WAL, bật khóa ngoại. */
export function openDatabase(file: string): ShimD1 {
  const sqlite = new DatabaseSync(file)
  sqlite.exec('PRAGMA journal_mode = WAL')
  sqlite.exec('PRAGMA synchronous = NORMAL')
  sqlite.exec('PRAGMA foreign_keys = ON')
  sqlite.exec('PRAGMA busy_timeout = 5000')
  return new ShimD1(sqlite)
}
