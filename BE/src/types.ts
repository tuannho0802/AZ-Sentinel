export type Bindings = {
  DB: D1Database
  /** "1" = trả meta rows_written/rows_read trong phản hồi ingest (chỉ dev/spike). */
  INGEST_DEBUG_META?: string
}

export type AppEnv = {
  Bindings: Bindings
  Variables: { requestId: string }
}
