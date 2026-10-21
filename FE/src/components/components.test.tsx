import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Button } from './Button'
import { Card } from './Card'
import { Delta, Money } from './Money'
import { Skeleton } from './Skeleton'

afterEach(cleanup)

describe('Money', () => {
  it('hiện số kèm đơn vị, thiếu số liệu thì "—"', () => {
    const { rerender } = render(<Money value={1234.5} currency="USD" />)
    expect(screen.getByText('1,234.50 USD')).toBeTruthy()
    rerender(<Money value={null} currency="USD" />)
    expect(screen.getByText('—')).toBeTruthy()
  })

  it('chữ số cùng độ rộng (lớp num)', () => {
    render(<Money value={1} currency="USD" />)
    expect(screen.getByText('1.00 USD').className).toContain('num')
  })

  it('nháy theo hướng đổi khi số thay đổi', () => {
    const { rerender } = render(<Money value={100} currency="USD" />)
    rerender(<Money value={120} currency="USD" />)
    expect(screen.getByText('120.00 USD').className).toContain('az-flash-up')
    rerender(<Money value={90} currency="USD" />)
    expect(screen.getByText('90.00 USD').className).toContain('az-flash-down')
  })

  it('không nháy ở lần hiển thị đầu', () => {
    render(<Money value={100} currency="USD" />)
    expect(screen.getByText('100.00 USD').className).not.toContain('az-flash')
  })
})

describe('Delta', () => {
  it('lãi: dấu +, màu gain, có mũi tên', () => {
    const { container } = render(<Delta value={5.5} currency="USD" />)
    const el = screen.getByText('+5.50 USD').parentElement as HTMLElement
    expect(el.className).toContain('text-gain')
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('lỗ: dấu −, màu loss, có mũi tên', () => {
    const { container } = render(<Delta value={-3.2} currency="USD" />)
    const el = screen.getByText('−3.20 USD').parentElement as HTMLElement
    expect(el.className).toContain('text-loss')
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('bằng 0: trung tính, không mũi tên', () => {
    const { container } = render(<Delta value={0} currency="USD" />)
    const el = screen.getByText('0.00 USD').parentElement as HTMLElement
    expect(el.className).toContain('text-muted')
    expect(container.querySelector('svg')).toBeNull()
  })

  it('thiếu số liệu: "—"', () => {
    render(<Delta value={undefined} currency="USD" />)
    expect(screen.getByText('—')).toBeTruthy()
  })
})

describe('Button', () => {
  it('mặc định type="button" để không gửi form ngoài ý muốn', () => {
    render(<Button>Lưu</Button>)
    expect(screen.getByRole('button', { name: 'Lưu' }).getAttribute('type')).toBe('button')
  })

  it('gọi onClick; disabled thì không gọi', () => {
    const onClick = vi.fn()
    const { rerender } = render(<Button onClick={onClick}>Bấm</Button>)
    fireEvent.click(screen.getByRole('button', { name: 'Bấm' }))
    expect(onClick).toHaveBeenCalledTimes(1)
    rerender(
      <Button disabled onClick={onClick}>
        Bấm
      </Button>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Bấm' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('cho phép type="submit"', () => {
    render(<Button type="submit">Gửi</Button>)
    expect(screen.getByRole('button', { name: 'Gửi' }).getAttribute('type')).toBe('submit')
  })
})

describe('Skeleton và Card', () => {
  it('Skeleton có role status, nhãn, và đủ số dòng', () => {
    const { container } = render(<Skeleton label="Đang tải" rows={3} />)
    expect(screen.getByRole('status', { name: 'Đang tải' })).toBeTruthy()
    expect(container.querySelectorAll('.az-skeleton')).toHaveLength(3)
  })

  it('Card hiện tiêu đề, nội dung và phần action', () => {
    render(
      <Card title="Tiêu đề" action={<button type="button">Hành động</button>}>
        Nội dung
      </Card>,
    )
    expect(screen.getByRole('heading', { name: 'Tiêu đề' })).toBeTruthy()
    expect(screen.getByText('Nội dung')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Hành động' })).toBeTruthy()
  })
})
