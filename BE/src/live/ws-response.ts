/**
 * Phản hồi nâng cấp WebSocket (101) kèm đầu `client` của `WebSocketPair`. Tách thành module riêng
 * vì máy chủ VPS (Node, Plan 3E) không tạo được `Response` mã 101 và thay module này khi đóng gói.
 */
export function upgradeResponse(client: WebSocket): Response {
    return new Response(null, { status: 101, webSocket: client })
}