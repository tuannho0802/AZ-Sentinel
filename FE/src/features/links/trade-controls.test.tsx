import type { LinkDetail } from '@az-sentinel/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { strings } from '../../lib/strings'
import { LinkDetailView } from './LinkDetailView'
import { applyLiveMessage, clearTradeResults } from './live/live-store'

const CMD = '0123456789abcdef'

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
    ea_ver: '0.5.0',
    vps_label: null,
    positions_count: 1,
    online: true,
  },
  positions: [
    {
      ticket: 777,
      symbol: 'XAUUSD',
      type: 'buy',
      volume: 0.1,
      time: 1,
      price: 4000,
      sl: 3990,
      tp: 0,
      profit: 5,
      swap: 0,
    },
  ],
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

beforeEach(() => {
  clearTradeResults()
  fetchMock = vi.fn(async () =>
    Response.json({ cmd_id: CMD, op: 'close', ticket: 777 }, { status: 202 }),
  )
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

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

describe('giao dịch từ xa trên trang chi tiết', () => {
  it('không phải admin, hoặc liên kết chưa bật giao dịch: không có nút giao dịch', () => {
    view({ admin: false })
    expect(screen.queryByRole('button', { name: strings.tradeBtnClose })).toBeNull()
    cleanup()
    view({ l: link({ trade_enabled: false }) })
    expect(screen.queryByRole('button', { name: strings.tradeBtnClose })).toBeNull()
    // admin vẫn thấy công tắc để bật
    expect(screen.getByRole('button', { name: strings.tradeRemoteEnable })).toBeTruthy()
  })

  it('terminal chưa Live: nút bị khóa', () => {
    view({ live: false })
    expect(
      (screen.getByRole('button', { name: strings.tradeBtnClose }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('đóng lệnh: phải xác nhận, gửi đúng thân, chờ kết quả thật rồi mới báo thành công', async () => {
    view()
    fireEvent.click(screen.getByRole('button', { name: strings.tradeBtnClose }))
    expect(screen.getByRole('dialog').textContent).toContain('777')
    expect(posted()).toHaveLength(0) // chưa xác nhận thì chưa gửi
    fireEvent.click(screen.getByRole('button', { name: strings.tradeConfirmSend }))
    await waitFor(() => expect(posted()).toHaveLength(1))
    expect(posted()[0]).toEqual({ url: '/api/links/7/trade', body: { op: 'close', ticket: 777 } })
    expect(await screen.findByText(strings.tradeWaiting)).toBeTruthy()
    expect(screen.queryByText(new RegExp(strings.tradeDone))).toBeNull() // 202 chưa phải thành công
    act(() => result())
    expect(await screen.findByText(new RegExp(`^${strings.tradeDone}`))).toBeTruthy()
  })

  it('sàn từ chối: hiện lý do và retcode thật', async () => {
    view()
    fireEvent.click(screen.getByRole('button', { name: strings.tradeBtnClose }))
    fireEvent.click(screen.getByRole('button', { name: strings.tradeConfirmSend }))
    await screen.findByText(strings.tradeWaiting)
    act(() =>
      result({ status: 'failed', reason: 'market_closed', code: 10018, detail: 'Market closed' }),
    )
    expect(await screen.findByText(new RegExp(strings.tradeReasons.market_closed))).toBeTruthy()
    expect(screen.getByText(/10018/)).toBeTruthy()
  })

  it('timeout: nói rõ là không biết lệnh đã chạy chưa', async () => {
    view()
    fireEvent.click(screen.getByRole('button', { name: strings.tradeBtnClose }))
    fireEvent.click(screen.getByRole('button', { name: strings.tradeConfirmSend }))
    await screen.findByText(strings.tradeWaiting)
    act(() => result({ status: 'timeout', reason: 'no_reply', code: 0, detail: '' }))
    expect(await screen.findByText(strings.tradeTimeout)).toBeTruthy()
  })

  it('đóng một phần: khối lượng >= đang mở hoặc trống bị chặn ngay ở FE', async () => {
    view()
    fireEvent.click(screen.getByRole('button', { name: strings.tradeBtnPartial }))
    const input = screen.getByRole('textbox')
    for (const bad of ['', '0', '0.1', '0.5', 'abc']) {
      fireEvent.change(input, { target: { value: bad } })
      fireEvent.click(screen.getByRole('button', { name: strings.tradeConfirmSend }))
      expect(screen.getByText(strings.tradeInvalidVolume)).toBeTruthy()
    }
    expect(posted()).toHaveLength(0)
    fireEvent.change(input, { target: { value: '0,03' } }) // dấu phẩy kiểu Việt
    fireEvent.click(screen.getByRole('button', { name: strings.tradeConfirmSend }))
    await waitFor(() => expect(posted()).toHaveLength(1))
    expect(posted()[0]?.body).toEqual({ op: 'partial_close', ticket: 777, volume: 0.03 })
  })

  it('sửa SL/TP: điền sẵn giá hiện tại, ô trống gửi 0 (bỏ)', async () => {
    view()
    fireEvent.click(screen.getByRole('button', { name: strings.tradeBtnModify }))
    const [sl, tp] = screen.getAllByRole('textbox') as HTMLInputElement[]
    expect(sl?.value).toBe('3990')
    expect(tp?.value).toBe('') // tp = 0 hiện trống
    fireEvent.change(sl as HTMLInputElement, { target: { value: '' } })
    fireEvent.change(tp as HTMLInputElement, { target: { value: '4100.5' } })
    fireEvent.click(screen.getByRole('button', { name: strings.tradeConfirmSend }))
    await waitFor(() => expect(posted()).toHaveLength(1))
    expect(posted()[0]?.body).toEqual({ op: 'modify', ticket: 777, sl: 0, tp: 4100.5 })
  })

  it('SL/TP âm hoặc không phải số bị chặn', () => {
    view()
    fireEvent.click(screen.getByRole('button', { name: strings.tradeBtnModify }))
    const [sl] = screen.getAllByRole('textbox') as HTMLInputElement[]
    fireEvent.change(sl as HTMLInputElement, { target: { value: '-5' } })
    fireEvent.click(screen.getByRole('button', { name: strings.tradeConfirmSend }))
    expect(screen.getByText(strings.tradeInvalidStops)).toBeTruthy()
    expect(posted()).toHaveLength(0)
  })

  it('server báo bận: hiện thông báo, không giả vờ đã gửi', async () => {
    fetchMock.mockImplementation(async () =>
      Response.json({ error: { code: 'TRADE_BUSY', message: 'x' } }, { status: 409 }),
    )
    view()
    fireEvent.click(screen.getByRole('button', { name: strings.tradeBtnClose }))
    fireEvent.click(screen.getByRole('button', { name: strings.tradeConfirmSend }))
    expect(await screen.findByText(strings.tradeErrBusy)).toBeTruthy()
    expect(screen.queryByText(strings.tradeWaiting)).toBeNull()
  })
})
