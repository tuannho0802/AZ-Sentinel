export type LogFields = Record<string, string | number | boolean | null>

/**
 * Log JSON một dòng. Chỉ truyền các trường đã chọn trước; KHÔNG truyền header,
 * body, API key, cookie (Rules BE mục 9).
 */
export function logJson(level: 'info' | 'warn' | 'error', fields: LogFields): void {
  console.log(JSON.stringify({ level, ...fields }))
}
