import { vi } from 'vitest'

/** WebSocket giả cho test: ghi lại mọi socket đã tạo và cho phép test đóng vai server. */
export class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  /** Số socket mở/đang nối đồng thời lớn nhất từng thấy (F-19). */
  static maxLive = 0

  static reset(): void {
    FakeWebSocket.instances = []
    FakeWebSocket.maxLive = 0
  }
  /** Số socket đang mở hoặc đang nối (F-19: không bao giờ lớn hơn 1). */
  static get live(): FakeWebSocket[] {
    return FakeWebSocket.instances.filter((s) => s.readyState <= FakeWebSocket.OPEN)
  }

  readyState = 0
  sent: string[] = []
  closeCode: number | null = null
  onopen: ((e: Event) => void) | null = null
  onmessage: ((e: MessageEvent) => void) | null = null
  onclose: ((e: CloseEvent) => void) | null = null
  onerror: ((e: Event) => void) | null = null

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
    FakeWebSocket.maxLive = Math.max(FakeWebSocket.maxLive, FakeWebSocket.live.length)
  }

  send(data: string): void {
    this.sent.push(data)
  }
  close(code = 1000): void {
    if (this.readyState === 3) return
    this.readyState = 3
    this.closeCode = code
    this.onclose?.(new Event('close') as CloseEvent)
  }

  /** Server chấp nhận kết nối. */
  serverOpen(): void {
    this.readyState = 1
    this.onopen?.(new Event('open'))
  }
  serverSend(message: unknown): void {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(message) }))
  }
  /** Server/mạng đóng kết nối. */
  serverClose(): void {
    this.readyState = 3
    this.onclose?.(new Event('close') as CloseEvent)
  }
  get messages(): unknown[] {
    return this.sent.map((s) => JSON.parse(s))
  }
}

export function installFakeWebSocket(): void {
  FakeWebSocket.reset()
  vi.stubGlobal('WebSocket', FakeWebSocket)
}
