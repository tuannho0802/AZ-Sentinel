/**
 * Plan 3J: "có người truy cập" nghĩa là gì ở phía VPS. Vì Worker chuyển hướng người dùng thẳng sang tunnel, mọi lượt
 * vào của người dùng đều tới VPS; VPS chỉ cần đếm các request của giao diện (trang, API người xem, WebSocket live).
 * Gateway, EA, kiểm tra sức khỏe và đường đồng bộ KHÔNG tính: chúng chạy 24/7 nên nếu tính thì không bao giờ "rảnh".
 */
const NOT_VISITORS = ['/api/health', '/api/ea/', '/api/gw/', '/api/sync', '/api/dev/']

export function isVisitorRequest(pathname: string): boolean {
  if (pathname !== '/api' && !pathname.startsWith('/api/')) return true
  return !NOT_VISITORS.some((p) =>
    p.endsWith('/') ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`),
  )
}
