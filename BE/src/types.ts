export type Bindings = {
  DB: D1Database
  /** "1" = trả meta rows_written/rows_read trong phản hồi ingest (chỉ dev/spike). */
  INGEST_DEBUG_META?: string
  /** "1" = bật /api/dev/* (quản lý liên kết không cần đăng nhập). Chỉ truyền bằng `wrangler dev --var`, KHÔNG đặt trong wrangler.jsonc. */
  DEV_LINKS_API?: string
}

export type AppEnv = {
  Bindings: Bindings
  Variables: { requestId: string }
}
