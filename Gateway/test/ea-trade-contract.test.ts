import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  eaVersionAtLeast,
  samplesRequestSchema,
  TRADE,
  TRADE_REASONS,
  tradeResultRequestSchema,
} from '@az-sentinel/shared'
import { describe, expect, it } from 'vitest'

/**
 * Hợp đồng giữa `ea/AZ_Spike.mq5` và phần còn lại của hệ thống cho giao dịch từ xa (v0.2.6).
 * Không có MetaEditor trong CI nên EA không được biên dịch hay chạy ở đây. Các test này chỉ đọc MÃ NGUỒN
 * EA để giữ những điều bất biến an toàn không bị sửa nhầm: công tắc mặc định tắt, ghi nhớ `cmd_id` TRƯỚC
 * khi gọi sàn, kiểm hạn dùng trước khi giao dịch, không có đường đặt lệnh mới, và mọi `reason` EA gửi đều
 * nằm trong danh sách mà schema nhận. Chạy EA trên tài khoản demo vẫn là bắt buộc trước khi dùng thật.
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const src = readFileSync(path.join(here, '../../ea/AZ_Spike.mq5'), 'utf8')

/** Thân hàm `ProcessTradeCommand` (từ khai báo tới hàm kế tiếp ở cột 0). */
function processBody(): string {
  const start = src.indexOf('void ProcessTradeCommand(')
  expect(start).toBeGreaterThan(-1)
  const next = src.indexOf('\n}\n', start)
  return src.slice(start, next + 3)
}

/** Thân một hàm MQL5 ở cột 0 (từ dòng khai báo tới `}` ở cột 0 kế tiếp). */
function funcBody(name: string): string {
  const m = new RegExp(`^\\w[\\w ]*\\b${name}\\(`, 'm').exec(src)
  expect(m, `hàm ${name} phải có`).not.toBeNull()
  const start = m?.index ?? 0
  return src.slice(start, src.indexOf('\n}\n', start) + 3)
}

describe('EA: các bất biến an toàn của giao dịch từ xa', () => {
  it('InpAllowRemoteTrading mặc định false', () => {
    expect(src).toMatch(/input\s+bool\s+InpAllowRemoteTrading\s*=\s*false\s*;/)
  })

  it('phiên bản EA đủ mới cho route (>= TRADE.minEaVer) và khớp #property version', () => {
    const ver = /#define\s+EA_VER\s+"(\d+\.\d+\.\d+)"/.exec(src)?.[1]
    expect(ver).toBeDefined()
    expect(eaVersionAtLeast(ver, TRADE.minEaVer)).toBe(true)
    expect(eaVersionAtLeast(ver, TRADE.minEaVerOpen)).toBe(true)
    const prop = /#property\s+version\s+"(\d+)\.(\d+)"/.exec(src)
    const [maj, min] = (ver ?? '').split('.')
    expect(prop?.[1]).toBe(maj)
    // `#property version` có dạng M.mm; "0.6.0" -> "0.60".
    expect(Number(prop?.[2])).toBe(Number(min) * 10 + Number((ver ?? '').split('.')[2]))
  })

  it('TR_MIN_START_MS của EA bằng TRADE.minStartMs của Shared', () => {
    const v = /#define\s+TR_MIN_START_MS\s+(\d+)/.exec(src)?.[1]
    expect(Number(v)).toBe(TRADE.minStartMs)
  })

  it('ghi nhớ cmd_id, kiểm công tắc và hạn dùng TRƯỚC mọi lệnh gọi sàn', () => {
    const body = processBody()
    const firstTrade = body.indexOf('g_trade.')
    expect(firstTrade).toBeGreaterThan(-1)
    const mustPrecede = (needle: string) => {
      const i = body.indexOf(needle)
      expect(i, `${needle} phải có trong ProcessTradeCommand`).toBeGreaterThan(-1)
      expect(i, `${needle} phải đứng trước lệnh gọi sàn đầu tiên`).toBeLessThan(firstTrade)
    }
    mustPrecede('CmdAlreadyDone(id)')
    mustPrecede('MarkCmdDone(id)')
    mustPrecede('InpAllowRemoteTrading')
    mustPrecede('ttl < TR_MIN_START_MS')
    mustPrecede('TERMINAL_TRADE_ALLOWED')
    mustPrecede('PositionSelectByTicket(ticket)')
  })

  it('MarkCmdDone chạy trước kiểm công tắc: lệnh bị từ chối cũng không chạy lại sau khi bật', () => {
    const body = processBody()
    expect(body.indexOf('MarkCmdDone(id)')).toBeLessThan(body.indexOf('InpAllowRemoteTrading'))
  })

  it('InpAllowRemoteOpen (mở lệnh mới) mặc định false, tách riêng khỏi InpAllowRemoteTrading', () => {
    expect(src).toMatch(/input\s+bool\s+InpAllowRemoteOpen\s*=\s*false\s*;/)
  })

  it('InpMaxRemoteVolume có trần mặc định nhỏ (<= 1 lot)', () => {
    const v = /input\s+double\s+InpMaxRemoteVolume\s*=\s*([\d.]+)\s*;/.exec(src)?.[1]
    expect(Number(v)).toBeGreaterThan(0)
    expect(Number(v)).toBeLessThanOrEqual(1)
  })

  it('lệnh MỞ (Buy/Sell/Limit/Stop) chỉ nằm trong RemoteMarket và RemotePending', () => {
    for (const banned of [
      'OrderSend(',
      'OrderSendAsync(',
      'g_trade.PositionOpen(',
      'g_trade.OrderOpen(',
    ]) {
      expect(src, banned).not.toContain(banned)
    }
    const allowed = [funcBody('RemoteMarket'), funcBody('RemotePending')]
    for (const call of ['Buy(', 'Sell(', 'BuyLimit(', 'SellLimit(', 'BuyStop(', 'SellStop(']) {
      const key = `g_trade.${call}`
      const total = src.split(key).length - 1
      const inAllowed = allowed.reduce((n, body) => n + (body.split(key).length - 1), 0)
      expect(total, `${key} phải có`).toBeGreaterThan(0)
      expect(inAllowed, `${key} chỉ được gọi trong RemoteMarket/RemotePending`).toBe(total)
    }
  })

  it('RemoteMarket và RemotePending qua cửa OpenAllowed TRƯỚC mọi lệnh gọi sàn', () => {
    for (const name of ['RemoteMarket', 'RemotePending']) {
      const body = funcBody(name)
      const gate = body.indexOf('OpenAllowed(id,')
      expect(gate, `${name} phải gọi OpenAllowed`).toBeGreaterThan(-1)
      expect(gate).toBeLessThan(body.indexOf('g_trade.'))
    }
  })

  it('OpenAllowed kiểm công tắc InpAllowRemoteOpen, mã giao dịch, khối lượng (trần InpMaxRemoteVolume)', () => {
    const gate = funcBody('OpenAllowed')
    expect(gate).toContain('InpAllowRemoteOpen')
    expect(gate).toContain('SymbolSelect(')
    expect(gate).toContain('OpenVolumeError(')
    expect(gate).not.toContain('g_trade.')
    expect(funcBody('OpenVolumeError')).toContain('InpMaxRemoteVolume')
  })

  it('lệnh mới/hàng loạt chỉ được xử lý sau khi qua công tắc, hạn dùng và Algo Trading', () => {
    const body = processBody()
    for (const call of ['RemoteMarket(', 'RemotePending(', 'RemoteCloseAll(']) {
      const i = body.indexOf(call)
      expect(i, `${call} phải được gọi từ ProcessTradeCommand`).toBeGreaterThan(-1)
      expect(i).toBeGreaterThan(body.indexOf('InpAllowRemoteTrading'))
      expect(i).toBeGreaterThan(body.indexOf('ttl < TR_MIN_START_MS'))
      expect(i).toBeGreaterThan(body.indexOf('TERMINAL_TRADE_ALLOWED'))
    }
  })

  it('close_all chỉ đóng vị thế (PositionClose), có giới hạn thời gian TR_MAX_RUN_MS < hạn dùng lệnh', () => {
    const body = funcBody('RemoteCloseAll')
    expect(body).toContain('g_trade.PositionClose(')
    expect(body).toContain('TR_MAX_RUN_MS')
    for (const banned of ['g_trade.Buy', 'g_trade.Sell', 'OrderDelete', 'PositionModify']) {
      expect(body, banned).not.toContain(banned)
    }
    const v = /#define\s+TR_MAX_RUN_MS\s+(\d+)/.exec(src)?.[1]
    expect(Number(v)).toBeLessThan(TRADE.ttlMs)
  })

  it('chỉ ba thao tác sàn: PositionClose, PositionClosePartial, PositionModify', () => {
    const calls = new Set([...src.matchAll(/g_trade\.(Position\w+)\(/g)].map((m) => m[1]))
    expect([...calls].sort()).toEqual(['PositionClose', 'PositionClosePartial', 'PositionModify'])
  })

  it('đóng một phần không tự làm tròn khối lượng (sai bước lot thì từ chối)', () => {
    const body = processBody()
    expect(body).toContain('bad_volume')
    expect(body).toMatch(/MathAbs\(aligned - want\)/)
  })
})

describe('EA: reason và status gửi đi nằm trong schema', () => {
  it('mọi reason EA dùng đều được schema nhận', () => {
    const queued = [...src.matchAll(/QueueTradeResult\(id,\s*"(\w+)",\s*"(\w+)"/g)]
    expect(queued.length).toBeGreaterThan(5)
    for (const m of queued) {
      expect(['done', 'failed']).toContain(m[1])
      expect(TRADE_REASONS).toContain(m[2] as (typeof TRADE_REASONS)[number])
    }
    const fromRetcode = src.slice(
      src.indexOf('string ReasonForRetcode('),
      src.indexOf('void ReportTradeOutcome('),
    )
    const returns = [...fromRetcode.matchAll(/return\s+"(\w+)"/g)].map((m) => m[1])
    expect(returns.length).toBeGreaterThan(3)
    for (const r of returns) expect(TRADE_REASONS).toContain(r as (typeof TRADE_REASONS)[number])
  })
})

describe('payload EA sinh ra (chép tay theo mã EA)', () => {
  const ident =
    '"v":1,"sid":"1A2B3C4D","key":"abcdefghijklmnopqrstuvwxyz","login":87654321,"server":"Exness-MT5Trial9"'

  it('trade_result thành công kèm khối lượng còn lại', () => {
    const body = `{${ident},"cmd_id":"0123456789abcdef","status":"done","reason":"ok","code":10009,"detail":"Request executed","left":0.03}`
    const r = tradeResultRequestSchema.parse(JSON.parse(body))
    expect(r).toMatchObject({ status: 'done', code: 10009, left: 0.03 })
  })

  it('trade_result thất bại trước khi gọi sàn (code 0, không có left)', () => {
    const body = `{${ident},"cmd_id":"0123456789abcdef","status":"failed","reason":"remote_disabled","code":0,"detail":"InpAllowRemoteTrading is off"}`
    const r = tradeResultRequestSchema.parse(JSON.parse(body))
    expect(r.reason).toBe('remote_disabled')
    expect(r.left).toBeUndefined()
  })

  it('mẫu samples có mg (margin) từ EA 0.5.0; EA cũ không có mg vẫn hợp lệ', () => {
    const withMg = `{${ident},"seq":1,"samples":[{"t":1760000000,"eq":10311.15,"bal":10250.40,"fl":60.75,"ml":null,"mg":120.50}]}`
    expect(samplesRequestSchema.parse(JSON.parse(withMg)).samples[0]?.mg).toBe(120.5)
    const old = `{${ident},"seq":1,"samples":[{"t":1760000000,"eq":10311.15,"bal":10250.40,"fl":60.75,"ml":null}]}`
    expect(samplesRequestSchema.parse(JSON.parse(old)).samples[0]?.mg).toBeUndefined()
  })
})
