import type { LinkDetail } from '@az-sentinel/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { strings } from '../../lib/strings'
import { LinkDetailView } from './LinkDetailView'
import { applyLiveMessage, clearTradeResults } from './live/live-store'

const CMD = '0123456789abcdef'

const pos = (ticket: number, type: 'buy' | 'sell', profit: number, swap = 0) => ({
  ticket,
  symbol: 'XAUUSD',
  type,
  volume: 0.1,
  time: 1,
  price: 4000,
  sl: 0,
  tp: 0,
  profit,
  swap,
})

// buy lãi 5 | sell lỗ -3 | buy lãi 2 nhưng swap -4 (ròng lỗ) | sell đúng 0
const POSITIONS = [pos(1, 'buy', 5), pos(2, 'sell', -3), pos(3, 'buy', 2, -4), pos(4, 'sell', 0)]

const link = (over: Partial<LinkDetail> = {}): LinkDetail => ({
  id: 7,
  key_prefix: 'k7',
  status: 'active',
  created_at: 1,
  bound_at: 1,
  vps_name: null,
  trade_enabled: true,
  account: { login: 1, server: 'S', broker: null, name: null, currency: 'USD', mode: 'demo' },
  state: {
    balance: 1000,
    equity: 1000,
    margin: 10,
    margin_free: 990,
    margin_level: null,
    floating_pl: 5,
    last_reason: null,
    last_seen_at: 1,
    last_seq: 1,
    ea_ver: '0.6.0',
    vps_label: null,
    positions_count: POSITIONS.length,
    online: true,
  },
  positions: POSITIONS,
  events: [],
  ...over,
})

let fetchMock: ReturnType<typeof vi.fn>

function view(props: { l?: LinkDetail; live?: boolean; admin?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <LinkDetailView
        link={props.l ?? link()}
        liveState={props.live === false ? null : 'live'}
        tradeAdmin={props.admin ?? true}
      />
    </QueryClientProvider>,
  )
}

const posted = () =>
  fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
    .map(([url, init]) => ({ url, body: JSON.parse(String((init as RequestInit).body)) }))

const result = (over: Record<string, unknown> = {}) =>
  applyLiveMessage({
    t: 'trade_result',
    id: 7,
    server_time: 1,
    cmd_id: CMD,
    status: 'done',
    reason: 'ok',
    code: 10009,
    detail: 'Request executed',
    ...over,
  } as never)

const dialog = () => within(screen.getByRole('dialog'))
const btn = (name: string) => dialog().getByRole('button', { name })
const fields = () => dialog().getAllByRole('textbox') as HTMLInputElement[]
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } })

function openOrder() {
  fireEvent.click(screen.getByRole('button', { name: strings.orderBtnOpen }))
}
function openCloseAll() {
  fireEvent.click(screen.getByRole('button', { name: strings.closeAllBtn }))
}

beforeEach(() => {
  clearTradeResults()
  fetchMock = vi.fn(async () =>
    Response.json({ cmd_id: CMD, op: 'market', ticket: null }, { status: 202 }),
  )
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('thanh nút Đặt lệnh / Đóng tất cả', () => {
  it('admin + liên kết đã bật giao dịch: có cả hai nút', () => {
    view()
    expect(screen.getByRole('button', { name: strings.orderBtnOpen })).toBeTruthy()
    expect(screen.getByRole('button', { name: strings.closeAllBtn })).toBeTruthy()
  })

  it('không phải admin hoặc chưa bật giao dịch: không có nút', () => {
    view({ admin: false })
    expect(screen.queryByRole('button', { name: strings.orderBtnOpen })).toBeNull()
    expect(screen.queryByRole('button', { name: strings.closeAllBtn })).toBeNull()
    cleanup()
    view({ l: link({ trade_enabled: false }) })
    expect(screen.queryByRole('button', { name: strings.orderBtnOpen })).toBeNull()
    expect(screen.queryByRole('button', { name: strings.closeAllBtn })).toBeNull()
  })

  it('terminal chưa Live: cả hai nút bị khóa', () => {
    view({ live: false })
    for (const name of [strings.orderBtnOpen, strings.closeAllBtn]) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true)
    }
  })
})

describe('Đặt lệnh Market', () => {
  it('mặc định Market + Buy, điền sẵn mã của lệnh đầu tiên, chưa gửi gì khi mới mở', () => {
    view()
    openOrder()
    expect(btn(strings.orderKindMarket).getAttribute('aria-pressed')).toBe('true')
    expect(btn(strings.orderSideBuy).getAttribute('aria-pressed')).toBe('true')
    expect(fields()[0]?.value).toBe('XAUUSD')
    expect(posted()).toHaveLength(0)
  })

  it('mã không hợp lệ hoặc khối lượng trống/0/chữ bị chặn ngay ở FE', () => {
    view()
    openOrder()
    type(fields()[0] as HTMLElement, 'XAU USD')
    type(fields()[1] as HTMLElement, '0.1')
    fireEvent.click(btn(strings.orderSubmit))
    expect(dialog().getByText(strings.orderInvalidSymbol)).toBeTruthy()

    type(fields()[0] as HTMLElement, 'XAUUSD')
    for (const bad of ['', '0', '-1', 'abc']) {
      type(fields()[1] as HTMLElement, bad)
      fireEvent.click(btn(strings.orderSubmit))
      expect(dialog().getByText(strings.orderInvalidVolume)).toBeTruthy()
    }
    expect(posted()).toHaveLength(0)
  })

  it('SL/TP không phải số bị chặn', () => {
    view()
    openOrder()
    type(fields()[1] as HTMLElement, '0.1')
    type(fields()[2] as HTMLElement, '-5')
    fireEvent.click(btn(strings.orderSubmit))
    expect(dialog().getByText(strings.tradeInvalidStops)).toBeTruthy()
    expect(posted()).toHaveLength(0)
  })

  it('gửi market sell: đúng thân, SL/TP trống = 0, dấu phẩy kiểu Việt được nhận', async () => {
    view()
    openOrder()
    fireEvent.click(btn(strings.orderSideSell))
    type(fields()[1] as HTMLElement, '0,25')
    type(fields()[3] as HTMLElement, '4100.5')
    fireEvent.click(btn(strings.orderSubmit))
    await waitFor(() => expect(posted()).toHaveLength(1))
    expect(posted()[0]).toEqual({
      url: '/api/links/7/trade',
      body: { op: 'market', symbol: 'XAUUSD', side: 'sell', volume: 0.25, sl: 0, tp: 4100.5 },
    })
  })

  it('202 chưa phải thành công; có kết quả mới báo, kèm ticket lệnh vừa tạo', async () => {
    view()
    openOrder()
    type(fields()[1] as HTMLElement, '0.1')
    fireEvent.click(btn(strings.orderSubmit))
    expect(await screen.findByText(strings.tradeWaiting)).toBeTruthy()
    expect(screen.queryByText(new RegExp(`^${strings.tradeDone}`))).toBeNull()
    act(() => result({ order: 555001 }))
    const done = await screen.findByText(new RegExp(`^${strings.tradeDone}`))
    expect(done.textContent).toContain('555001')
    expect(done.textContent).toContain('10009')
  })

  it('sau khi gửi: khóa các ô nhập và không còn nút Gửi (tránh gửi đúp)', async () => {
    view()
    openOrder()
    type(fields()[1] as HTMLElement, '0.1')
    fireEvent.click(btn(strings.orderSubmit))
    await screen.findByText(strings.tradeWaiting)
    expect(dialog().queryByRole('button', { name: strings.orderSubmit })).toBeNull()
    for (const f of fields()) expect(f.disabled).toBe(true)
    expect(posted()).toHaveLength(1)
  })

  it('EA chưa bật InpAllowRemoteOpen: hiện đúng lý do', async () => {
    view()
    openOrder()
    type(fields()[1] as HTMLElement, '0.1')
    fireEvent.click(btn(strings.orderSubmit))
    await screen.findByText(strings.tradeWaiting)
    act(() => result({ status: 'failed', reason: 'remote_disabled', code: 0, detail: '' }))
    expect(
      await screen.findByText((t) => t.includes(strings.tradeReasons.remote_disabled)),
    ).toBeTruthy()
  })

  it('server báo bận: hiện thông báo, không giả vờ đã gửi', async () => {
    fetchMock.mockImplementation(async () =>
      Response.json({ error: { code: 'TRADE_BUSY', message: 'x' } }, { status: 409 }),
    )
    view()
    openOrder()
    type(fields()[1] as HTMLElement, '0.1')
    fireEvent.click(btn(strings.orderSubmit))
    expect(await screen.findByText(strings.tradeErrBusy)).toBeTruthy()
    expect(screen.queryByText(strings.tradeWaiting)).toBeNull()
  })
})

describe('Đặt lệnh chờ Limit/Stop', () => {
  it('chọn Limit/Stop thì hiện ô giá vào; Market thì không', () => {
    view()
    openOrder()
    expect(fields()).toHaveLength(4) // mã, lot, SL, TP
    fireEvent.click(btn(strings.orderKindLimit))
    expect(fields()).toHaveLength(5)
    fireEvent.click(btn(strings.orderKindStop))
    expect(fields()).toHaveLength(5)
    fireEvent.click(btn(strings.orderKindMarket))
    expect(fields()).toHaveLength(4)
  })

  it('thiếu hoặc sai giá vào bị chặn', () => {
    view()
    openOrder()
    fireEvent.click(btn(strings.orderKindLimit))
    type(fields()[1] as HTMLElement, '0.1')
    for (const bad of ['', '0', '-3', 'x']) {
      type(fields()[2] as HTMLElement, bad)
      fireEvent.click(btn(strings.orderSubmit))
      expect(dialog().getByText(strings.orderInvalidPrice)).toBeTruthy()
    }
    expect(posted()).toHaveLength(0)
  })

  it('SL/TP sai phía so với giá vào bị chặn ở FE (buy: SL phải dưới giá)', () => {
    view()
    openOrder()
    fireEvent.click(btn(strings.orderKindLimit))
    type(fields()[1] as HTMLElement, '0.1')
    type(fields()[2] as HTMLElement, '4000')
    type(fields()[3] as HTMLElement, '4010') // SL trên giá vào: sai cho buy
    fireEvent.click(btn(strings.orderSubmit))
    expect(dialog().getByText(strings.orderInvalidStopSide)).toBeTruthy()
    expect(posted()).toHaveLength(0)
  })

  it('buy limit hợp lệ: gửi op pending, kind buy_limit', async () => {
    view()
    openOrder()
    fireEvent.click(btn(strings.orderKindLimit))
    type(fields()[1] as HTMLElement, '0.1')
    type(fields()[2] as HTMLElement, '3990')
    type(fields()[3] as HTMLElement, '3980')
    type(fields()[4] as HTMLElement, '4010')
    fireEvent.click(btn(strings.orderSubmit))
    await waitFor(() => expect(posted()).toHaveLength(1))
    expect(posted()[0]?.body).toEqual({
      op: 'pending',
      symbol: 'XAUUSD',
      kind: 'buy_limit',
      volume: 0.1,
      price: 3990,
      sl: 3980,
      tp: 4010,
    })
  })

  it('sell stop: kind ghép đúng từ hướng và loại, SL phải trên giá', async () => {
    view()
    openOrder()
    fireEvent.click(btn(strings.orderKindStop))
    fireEvent.click(btn(strings.orderSideSell))
    type(fields()[1] as HTMLElement, '0.2')
    type(fields()[2] as HTMLElement, '3900')
    type(fields()[3] as HTMLElement, '3890') // SL dưới giá: sai cho sell
    fireEvent.click(btn(strings.orderSubmit))
    expect(dialog().getByText(strings.orderInvalidStopSide)).toBeTruthy()
    type(fields()[3] as HTMLElement, '3910')
    type(fields()[4] as HTMLElement, '3880')
    fireEvent.click(btn(strings.orderSubmit))
    await waitFor(() => expect(posted()).toHaveLength(1))
    expect(posted()[0]?.body).toMatchObject({
      op: 'pending',
      kind: 'sell_stop',
      volume: 0.2,
      price: 3900,
      sl: 3910,
      tp: 3880,
    })
  })

  it('lệnh chờ không SL/TP (để trống) vẫn hợp lệ', async () => {
    view()
    openOrder()
    fireEvent.click(btn(strings.orderKindLimit))
    type(fields()[1] as HTMLElement, '0.1')
    type(fields()[2] as HTMLElement, '3990')
    fireEvent.click(btn(strings.orderSubmit))
    await waitFor(() => expect(posted()).toHaveLength(1))
    expect(posted()[0]?.body).toMatchObject({ sl: 0, tp: 0 })
  })
})

describe('Đóng tất cả', () => {
  it('mặc định "Tất cả" và hiện số lệnh sẽ đóng; chưa gửi gì khi mới mở', () => {
    view()
    openCloseAll()
    expect((dialog().getByLabelText(strings.closeAllFilterAll) as HTMLInputElement).checked).toBe(
      true,
    )
    expect(dialog().getByText(strings.closeAllMatched(4))).toBeTruthy()
    expect(posted()).toHaveLength(0)
  })

  it('đếm theo bộ lọc, lãi/lỗ tính cả swap, đúng 0 không thuộc lãi/lỗ', () => {
    view()
    openCloseAll()
    const pick = (label: string) => fireEvent.click(dialog().getByLabelText(label))
    pick(strings.closeAllFilterProfit)
    expect(dialog().getByText(strings.closeAllMatched(1))).toBeTruthy() // chỉ lệnh #1
    pick(strings.closeAllFilterLoss)
    expect(dialog().getByText(strings.closeAllMatched(2))).toBeTruthy() // #2 và #3 (swap kéo lỗ)
    pick(strings.closeAllFilterBuy)
    expect(dialog().getByText(strings.closeAllMatched(2))).toBeTruthy()
    pick(strings.closeAllFilterSell)
    expect(dialog().getByText(strings.closeAllMatched(2))).toBeTruthy()
  })

  it('không có lệnh nào khớp: báo rõ và khóa nút xác nhận', () => {
    view({ l: link({ positions: [pos(1, 'buy', 5)] }) })
    openCloseAll()
    fireEvent.click(dialog().getByLabelText(strings.closeAllFilterLoss))
    expect(dialog().getByText(strings.closeAllNone)).toBeTruthy()
    expect((btn(strings.tradeConfirmSend) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(btn(strings.tradeConfirmSend))
    expect(posted()).toHaveLength(0)
  })

  it('xác nhận gửi đúng bộ lọc đã chọn', async () => {
    view()
    openCloseAll()
    fireEvent.click(dialog().getByLabelText(strings.closeAllFilterProfit))
    fireEvent.click(btn(strings.tradeConfirmSend))
    await waitFor(() => expect(posted()).toHaveLength(1))
    expect(posted()[0]).toEqual({
      url: '/api/links/7/trade',
      body: { op: 'close_all', filter: 'profit' },
    })
  })

  it('mặc định gửi filter all', async () => {
    view()
    openCloseAll()
    fireEvent.click(btn(strings.tradeConfirmSend))
    await waitFor(() => expect(posted()).toHaveLength(1))
    expect(posted()[0]?.body).toEqual({ op: 'close_all', filter: 'all' })
  })

  it('kết quả: hiện số lệnh đóng được/lỗi từ n_ok, n_fail', async () => {
    view()
    openCloseAll()
    fireEvent.click(btn(strings.tradeConfirmSend))
    await screen.findByText(strings.tradeWaiting)
    act(() => result({ n_ok: 4, n_fail: 0 }))
    const done = await screen.findByText(new RegExp(`^${strings.tradeDone}`))
    expect(done.textContent).toContain(strings.tradeCounts(4, 0))
  })

  it('thất bại một phần: hiện lý do và số đóng được/lỗi', async () => {
    view()
    openCloseAll()
    fireEvent.click(btn(strings.tradeConfirmSend))
    await screen.findByText(strings.tradeWaiting)
    act(() =>
      result({
        status: 'failed',
        reason: 'partial',
        code: 10018,
        detail: 'Market closed',
        n_ok: 3,
        n_fail: 1,
      }),
    )
    expect(await screen.findByText((t) => t.includes(strings.tradeReasons.partial))).toBeTruthy()
    expect(screen.getByText(strings.tradeCounts(3, 1))).toBeTruthy()
    expect(screen.getByText(/10018/)).toBeTruthy()
  })

  it('sau khi gửi: khóa lựa chọn bộ lọc để không gửi đúp', async () => {
    view()
    openCloseAll()
    fireEvent.click(btn(strings.tradeConfirmSend))
    await screen.findByText(strings.tradeWaiting)
    expect(dialog().queryByRole('button', { name: strings.tradeConfirmSend })).toBeNull()
    // radio bị khóa qua <fieldset disabled>, nên kiểm bằng :disabled chứ không phải thuộc tính .disabled
    expect(dialog().getByLabelText(strings.closeAllFilterLoss).matches(':disabled')).toBe(true)
    expect(posted()).toHaveLength(1)
  })

  it('hủy: đóng hộp thoại mà không gửi gì', () => {
    view()
    openCloseAll()
    fireEvent.click(btn(strings.tradeCancel))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(posted()).toHaveLength(0)
  })
})
