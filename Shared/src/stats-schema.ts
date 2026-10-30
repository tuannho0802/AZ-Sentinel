import { z } from 'zod'

/**
 * Thống kê lãi/lỗ theo kỳ (EA 0.7.0). EA TỰ tính từ lịch sử MT5 rồi gửi Gateway (`POST /v1/stats`);
 * Gateway chuyển nguyên lên cloud, hub chuyển nguyên cho trình duyệt xem trang chi tiết. Server/Worker
 * KHÔNG cộng, KHÔNG lọc, KHÔNG ghi D1: chỉ chuyển tiếp và giữ bản mới nhất trong bộ nhớ.
 *
 * Mỗi kỳ có HAI cách tính, EA gửi cả hai để FE đổi qua lại không cần hỏi lại:
 *  - `open`: lệnh được tính vào kỳ chứa Open Time của lệnh.
 *  - `close`: lệnh được tính vào kỳ chứa Close Time của lệnh.
 * Chỉ tính lệnh đã đóng. P/L mỗi lệnh = profit + swap + commission + fee của mọi deal cùng position.
 */
export const STAT_PERIODS = ['today', 'yesterday', 'd3', 'lastweek', 'lastmonth'] as const
export type StatPeriodKey = (typeof STAT_PERIODS)[number]

export const STAT_BASES = ['open', 'close'] as const
export type StatBasis = (typeof STAT_BASES)[number]

const num = z.number().finite()
const count = z.number().int().nonnegative()

/** Tổng của một cách tính trong một kỳ. */
export const statBucketSchema = z.object({
  /** Tổng lãi/lỗ ròng (đã gồm swap, commission, fee). */
  pl: num,
  /** Số lệnh đã đóng được tính. */
  n: count,
  /** Số lệnh lãi ròng (> 0). */
  w: count,
})
export type StatBucket = z.infer<typeof statBucketSchema>

/** `from` (gồm) và `to` (không gồm) là Unix giây UTC; ranh giới ngày/tuần/tháng theo giờ SERVER của sàn (như MT5). */
export const statPeriodSchema = z.object({
  from: z.number().int(),
  to: z.number().int(),
  open: statBucketSchema,
  close: statBucketSchema,
})
export type StatPeriod = z.infer<typeof statPeriodSchema>

export const statsFields = {
  /** Lúc EA tính xong (Unix giây UTC). */
  sts: z.number().int().nonnegative(),
  ccy: z.string().max(8).optional(),
  periods: z.object({
    today: statPeriodSchema,
    yesterday: statPeriodSchema,
    d3: statPeriodSchema,
    lastweek: statPeriodSchema,
    lastmonth: statPeriodSchema,
  }),
}

export const statsSchema = z.object(statsFields)
export type Stats = z.infer<typeof statsSchema>
