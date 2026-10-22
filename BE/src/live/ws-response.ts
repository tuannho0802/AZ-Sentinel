/**
 * Phản hồi nâng cấp WebSocket (101) kèm đầu `client` của `WebSocketPair`.
 *
 * Máy chủ VPS (Node, Plan 3E) không tạo được `Response` mã 101, nên nó đặt `globalThis.__azUpgrade`
 * (xem `Server/src/shim/cloudflare-workers.ts`) để trả phản hồi thường mang mã cặp socket; tầng HTTP của
 * Node đọc mã đó rồi hoàn tất bắt tay. Worker thật không đặt móc nên đi đường 101.
 */
type UpgradeHook = (client: WebSocket) => Response

export function upgradeResponse(client: WebSocket): Response {
  const hook = (globalThis as { __azUpgrade?: UpgradeHook }).__azUpgrade
  if (hook) return hook(client)
  return new Response(null, { status: 101, webSocket: client })
}
