import { describe, expect, it } from 'vitest'
import { Gateway, MAX_TERMINALS, TooManyTerminalsError } from '../src/gateway'
import { LocalServer } from '../src/local-server'
import { eventReq, ping } from './helpers'

const JSON_HEADERS = { 'Content-Type': 'application/json' }

describe('giới hạn số terminal (chặn tiến trình cục bộ làm đầy bộ nhớ)', () => {
  it('terminal thứ MAX_TERMINALS+1 bị từ chối, terminal đã có vẫn ping được', () => {
    const gw = new Gateway({ cloudConfigured: false, idleFlushSec: 0 })
    for (let i = 0; i < MAX_TERMINALS; i++) gw.handlePing(ping({ login: 1000 + i }))
    expect(() => gw.handlePing(ping({ login: 999_999 }))).toThrow(TooManyTerminalsError)
    expect(() => gw.handleEvent(eventReq({ login: 999_999 }))).toThrow(TooManyTerminalsError)
    expect(() => gw.handlePing(ping({ login: 1000 }))).not.toThrow()
  })

  it('qua HTTP: 429 too_many_terminals, không phải 500', async () => {
    const gw = new Gateway({ cloudConfigured: false, idleFlushSec: 0 })
    const srv = new LocalServer(gw, 0)
    await srv.start()
    const base = `http://127.0.0.1:${srv.listeningPort}`
    const post = (path: string, body: unknown) =>
      fetch(base + path, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) })
    try {
      for (let i = 0; i < MAX_TERMINALS; i++) {
        expect((await post('/v1/ping', ping({ login: 2000 + i }))).status).toBe(200)
      }
      const over = await post('/v1/ping', ping({ login: 888_888 }))
      expect(over.status).toBe(429)
      expect(await over.json()).toEqual({ ok: false, error: 'too_many_terminals' })
      const overEvent = await post('/v1/event', eventReq({ login: 888_888 }))
      expect(overEvent.status).toBe(429)
    } finally {
      await srv.stop()
      gw.stop()
    }
  })
})
