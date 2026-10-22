export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>

/** `fetch` thật của runtime; bọc để không mất `this` (Workers báo "Illegal invocation" nếu tách rời). */
export const realFetch: FetchFn = (input, init) => fetch(input, init)

/**
 * `fetch` có hạn chờ phản hồi (header). Hạn chỉ canh đến khi có phản hồi: sau đó bỏ canh để không
 * làm đứt WebSocket đã nâng cấp hay luồng đang tải.
 */
export async function timedFetch(
    fetchFn: FetchFn,
    input: string,
    init: RequestInit,
    timeoutMs: number,
): Promise<Response> {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeoutMs)
    try {
        return await fetchFn(input, { ...init, signal: ctl.signal })
    } finally {
        clearTimeout(timer)
    }
}