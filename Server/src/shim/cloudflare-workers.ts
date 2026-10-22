import { randomUUID } from 'node:crypto'
import type { WebSocket as WsSocket } from 'ws'

/**
 * Shim của `cloudflare:workers` để chạy nguyên `LiveHub` (Durable Object) trên Node (Plan 3E).
 * Chỉ hiện thực phần hub dùng: `DurableObject`, `ctx.acceptWebSocket/getWebSockets/getTags`, tự đáp
 * ping/pong, `storage.kv`, `WebSocketPair`, `serializeAttachment`. Tiến trình Node không ngủ đông nên
 * trạng thái nằm thẳng trong bộ nhớ; hành vi còn lại giữ nguyên để hub không phải sửa.
 */

/** Header nội bộ trên phản hồi do `upgradeResponse` tạo: mã cặp socket chờ hoàn tất bắt tay. */
export const PAIR_HEADER = 'x-az-ws-pair'
const PAIR_TTL_MS = 30_000

type Pending =
  | { k: 'send'; d: string | ArrayBuffer }
  | { k: 'close'; code?: number; reason?: string }

export interface HubHandlers {
  webSocketMessage?(ws: ShimWebSocket, message: string | ArrayBuffer): void | Promise<void>
  webSocketClose?(
    ws: ShimWebSocket,
    code: number,
    reason: string,
    wasClean: boolean,
  ): void | Promise<void>
  webSocketError?(ws: ShimWebSocket, error: unknown): void | Promise<void>
}

/** Đầu "server" của một WebSocket. Tin gửi/đóng trước khi bắt tay xong được xếp hàng rồi xả ra. */
export class ShimWebSocket {
  tags: string[] = []
  autoResponseAt: Date | null = null
  private attachment: string | null = null
  private real: WsSocket | null = null
  private queue: Pending[] = []
  private closing = false
  private closed = false
  state: ShimState | null = null

  /** 1 = OPEN (kể cả chưa bắt tay xong), 2 = CLOSING, 3 = CLOSED. */
  get readyState(): number {
    return this.closed ? 3 : this.closing ? 2 : 1
  }

  accept(): void {}

  serializeAttachment(value: unknown): void {
    this.attachment = JSON.stringify(value)
  }

  deserializeAttachment(): unknown {
    return this.attachment === null ? null : JSON.parse(this.attachment)
  }

  send(data: string | ArrayBuffer): void {
    if (this.closing || this.closed) throw new Error('WebSocket đã đóng')
    if (!this.real) this.queue.push({ k: 'send', d: data })
    else if (this.real.readyState === 1) this.real.send(data)
  }

  close(code?: number, reason?: string): void {
    if (this.closing || this.closed) return
    this.closing = true
    if (!this.real) this.queue.push({ k: 'close', code, reason })
    else this.real.close(code, reason)
  }

  /** Gắn socket thật sau khi bắt tay nâng cấp xong. */
  bind(real: WsSocket): void {
    this.real = real
    real.on('message', (data, isBinary) => {
      const message = isBinary ? toArrayBuffer(data) : data.toString()
      void this.state?.dispatchMessage(this, message)
    })
    real.on('error', (error) => {
      if (!this.closed) void this.state?.dispatchError(this, error)
    })
    real.on('close', (code, reason) => {
      this.closed = true
      void this.state?.dispatchClose(this, code, reason.toString())
    })
    for (const item of this.queue.splice(0)) {
      if (item.k === 'send') real.send(item.d)
      else real.close(item.code, item.reason)
    }
  }

  /** Cặp không bao giờ được nhận (client không hoàn tất bắt tay): coi như đã đóng. */
  abandon(): void {
    this.closed = true
    this.state?.remove(this)
  }
}

function toArrayBuffer(data: unknown): ArrayBuffer {
  const buf = Array.isArray(data) ? Buffer.concat(data as Buffer[]) : (data as Buffer)
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

class ShimKv {
  private readonly map = new Map<string, unknown>()

  get<T>(key: string): T | undefined {
    return this.map.get(key) as T | undefined
  }

  put(key: string, value: unknown): void {
    this.map.set(key, structuredClone(value))
  }

  delete(key: string): boolean {
    return this.map.delete(key)
  }

  *list(opts?: { prefix?: string }): Generator<[string, unknown]> {
    for (const entry of [...this.map]) {
      if (!opts?.prefix || entry[0].startsWith(opts.prefix)) yield entry
    }
  }
}

export class WebSocketRequestResponsePair {
  constructor(
    readonly request: string,
    readonly response: string,
  ) {}
}

/** Thay `DurableObjectState`. Một hub duy nhất nên không cần phân tách theo id. */
export class ShimState {
  readonly storage = { kv: new ShimKv() }
  private readonly sockets = new Set<ShimWebSocket>()
  private auto: WebSocketRequestResponsePair | null = null
  private hub: HubHandlers | null = null
  private onError: (error: unknown) => void = (error) => console.error('hub lỗi:', error)

  attach(hub: HubHandlers, onError?: (error: unknown) => void): void {
    this.hub = hub
    if (onError) this.onError = onError
  }

  acceptWebSocket(ws: ShimWebSocket, tags: string[] = []): void {
    ws.tags = tags
    ws.state = this
    this.sockets.add(ws)
  }

  getWebSockets(tag?: string): ShimWebSocket[] {
    return [...this.sockets].filter((w) => tag === undefined || w.tags.includes(tag))
  }

  getTags(ws: ShimWebSocket): string[] {
    return ws.tags
  }

  setWebSocketAutoResponse(pair: WebSocketRequestResponsePair | null): void {
    this.auto = pair
  }

  getWebSocketAutoResponseTimestamp(ws: ShimWebSocket): Date | null {
    return ws.autoResponseAt
  }

  remove(ws: ShimWebSocket): void {
    this.sockets.delete(ws)
  }

  async dispatchMessage(ws: ShimWebSocket, message: string | ArrayBuffer): Promise<void> {
    if (this.auto && message === this.auto.request) {
      ws.autoResponseAt = new Date()
      try {
        ws.send(this.auto.response)
      } catch {
        // đã đóng
      }
      return
    }
    await this.run(() => this.hub?.webSocketMessage?.(ws, message))
  }

  async dispatchError(ws: ShimWebSocket, error: unknown): Promise<void> {
    await this.run(() => this.hub?.webSocketError?.(ws, error))
  }

  async dispatchClose(ws: ShimWebSocket, code: number, reason: string): Promise<void> {
    this.remove(ws) // trước khi báo hub, để hub tính lại `watch` không còn thấy socket này
    await this.run(() => this.hub?.webSocketClose?.(ws, code, reason, true))
  }

  private async run(fn: () => void | Promise<void> | undefined): Promise<void> {
    try {
      await fn()
    } catch (error) {
      this.onError(error)
    }
  }
}

export class DurableObject<E = unknown> {
  constructor(
    readonly ctx: ShimState,
    readonly env: E,
  ) {}
}

// ------------------------------------------------------------------ WebSocketPair

const pairs = new Map<string, ShimWebSocket>()

/** Đầu "client" của cặp: chỉ mang mã để tầng HTTP tìm lại đầu server khi bắt tay. */
class ShimClientEnd {
  constructor(
    readonly id: string,
    readonly server: ShimWebSocket,
  ) {}
}

class ShimWebSocketPair {
  0: ShimClientEnd
  1: ShimWebSocket

  constructor() {
    const id = randomUUID()
    const server = new ShimWebSocket()
    pairs.set(id, server)
    setTimeout(() => {
      if (pairs.delete(id)) server.abandon()
    }, PAIR_TTL_MS).unref()
    this[0] = new ShimClientEnd(id, server)
    this[1] = server
  }
}

/** Lấy (và xóa) đầu server theo mã; null nếu không có hoặc đã hết hạn. */
export function takePair(id: string): ShimWebSocket | null {
  const server = pairs.get(id) ?? null
  pairs.delete(id)
  return server
}

const g = globalThis as Record<string, unknown>
g.WebSocketPair = ShimWebSocketPair
g.WebSocketRequestResponsePair = WebSocketRequestResponsePair
/** Móc mà `BE/src/live/ws-response.ts` gọi thay cho `new Response(null, { status: 101 })`. */
g.__azUpgrade = (client: ShimClientEnd): Response =>
  new Response(null, { status: 200, headers: { [PAIR_HEADER]: client.id } })
