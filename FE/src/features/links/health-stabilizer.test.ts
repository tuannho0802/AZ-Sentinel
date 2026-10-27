import { describe, expect, it } from 'vitest'
import {
  HEALTH_DOWNGRADE_GRACE_MS as GRACE,
  type HealthStabilizer,
  pruneStabilizer,
  stabilizeHealth,
} from './health-stabilizer'

const run = (
  store: HealthStabilizer,
  ...steps: [raw: Parameters<typeof stabilizeHealth>[2], at: number][]
) => steps.map(([raw, at]) => stabilizeHealth(store, 1, raw, at))

describe('stabilizeHealth', () => {
  it('lần đầu thấy liên kết thì lấy nguyên trạng thái thô', () => {
    expect(run(new Map(), ['offline', 0])).toEqual(['offline'])
  })

  it('mất kết nối thoáng qua (10s) vẫn giữ Live, không nhảy sang cần chú ý', () => {
    const s: HealthStabilizer = new Map()
    expect(run(s, ['live', 0], ['silent', 11_000], ['offline', 15_000], ['live', 21_000])).toEqual([
      'live',
      'live',
      'live',
      'live',
    ])
  })

  it('xấu liên tục đủ ân hạn thì mới hạ', () => {
    const s: HealthStabilizer = new Map()
    expect(
      run(
        s,
        ['live', 0],
        ['silent', 1_000],
        ['silent', 1_000 + GRACE - 1],
        ['silent', 1_000 + GRACE],
      ),
    ).toEqual(['live', 'live', 'live', 'silent'])
  })

  it('tín hiệu quay lại giữa chừng thì đếm lại từ đầu', () => {
    const s: HealthStabilizer = new Map()
    expect(
      run(
        s,
        ['live', 0],
        ['silent', 1_000],
        ['live', 50_000], // quay lại trước 60s -> hủy
        ['silent', 51_000], // bắt đầu đếm lại
        ['silent', 51_000 + GRACE - 1],
      ),
    ).toEqual(['live', 'live', 'live', 'live', 'live'])
  })

  it('online <-> waking đổi tức thì; live -> waking (nối chập chờn) thì được làm mượt', () => {
    const s: HealthStabilizer = new Map()
    expect(run(s, ['online', 0], ['waking', 1], ['online', 2])).toEqual([
      'online',
      'waking',
      'online',
    ])
    expect(run(s, ['live', 3], ['waking', 4])).toEqual(['live', 'live'])
  })

  it('tốt lên thì hiện ngay', () => {
    const s: HealthStabilizer = new Map()
    expect(run(s, ['offline', 0], ['live', 1])).toEqual(['offline', 'live'])
  })

  it('awaiting/disabled đổi tức thì và xóa bộ nhớ', () => {
    const s: HealthStabilizer = new Map()
    expect(run(s, ['live', 0], ['disabled', 1], ['live', 2])).toEqual(['live', 'disabled', 'live'])
    expect(run(s, ['awaiting', 3])).toEqual(['awaiting'])
    expect(s.has(1)).toBe(false)
  })

  it('pruneStabilizer bỏ liên kết không còn trong danh sách', () => {
    const s: HealthStabilizer = new Map()
    stabilizeHealth(s, 1, 'live', 0)
    stabilizeHealth(s, 2, 'live', 0)
    pruneStabilizer(s, new Set([2]))
    expect([...s.keys()]).toEqual([2])
  })
})
