/** Địa chỉ EA gửi dữ liệu. Ở dev, BE chạy cổng 8787 (khác cổng FE 5173). */
export function ingestUrl(): string {
  return import.meta.env.DEV
    ? 'http://127.0.0.1:8787/api/ea/v1/ingest'
    : `${window.location.origin}/api/ea/v1/ingest`
}
