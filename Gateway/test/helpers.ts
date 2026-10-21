import type {
  EventRequest,
  GwClientMessage,
  GwServerMessage,
  PingRequest,
  SamplesRequest,
} from '@az-sentinel/shared'

export const KEY = 'test-key-0123456789'
export const snap = { bal: 1000, eq: 1010.5, fl: 10.5, ml: null }
export const sample = (t: number) => ({ t, eq: 1010.5, bal: 1000, fl: 10.5, ml: null })

export function ping(over: Partial<PingRequest> = {}): PingRequest {
  return {
    v: 1,
    sid: 'S1',
    key: KEY,
    login: 111,
    server: 'Demo-1',
    ea_ver: '0.2.0',
    mode: 'demo',
    conn: true,
    snap,
    ...over,
  }
}

export function samplesReq(over: Partial<SamplesRequest> = {}): SamplesRequest {
  return {
    v: 1,
    sid: 'S1',
    key: KEY,
    login: 111,
    server: 'Demo-1',
    seq: 1,
    samples: [sample(1_760_000_000)],
    ...over,
  }
}

export function eventReq(over: Partial<EventRequest> = {}): EventRequest {
  return {
    v: 1,
    sid: 'S1',
    key: KEY,
    login: 111,
    server: 'Demo-1',
    seq: 1,
    reason: ['trade_event'],
    events: [{ kind: 'close', deal_ticket: 9, position_id: 7, time: 1_760_000_000, profit: 3 }],
    ...over,
  }
}

/** Cloud giả cho kiểm thử logic: ghi lại mọi tin Gateway gửi. */
export function fakeCloud() {
  const sent: GwClientMessage[] = []
  const send = (m: GwClientMessage) => {
    sent.push(m)
    return true
  }
  return {
    sent,
    send,
    of: <T extends GwClientMessage['t']>(t: T) =>
      sent.filter((m): m is Extract<GwClientMessage, { t: T }> => m.t === t),
    clear: () => {
      sent.length = 0
    },
  }
}

export const bound = (tid: string): GwServerMessage => ({ t: 'bound', tid, link_id: 1 })
