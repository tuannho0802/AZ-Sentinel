import { describe, expect, it } from 'vitest'
import {
    clampIntervalSec,
    clampPollSec,
    clientMessageSchema,
    LIVE,
    serverMessageSchema,
} from '../src/live-schema'

const sample = { t: 1792500000, eq: 10311.15, bal: 10250.4, fl: 60.75, ml: null }

describe('clampIntervalSec', () => {
    it('kẹp vào [3, 30] và dùng mặc định cho giá trị không hợp lệ', () => {
        expect(clampIntervalSec(1)).toBe(3)
        expect(clampIntervalSec(0)).toBe(3)
        expect(clampIntervalSec(-5)).toBe(3)
        expect(clampIntervalSec(10)).toBe(10)
        expect(clampIntervalSec(30)).toBe(30)
        expect(clampIntervalSec(99)).toBe(30)
        expect(clampIntervalSec(7.6)).toBe(8)
        expect(clampIntervalSec(Number.NaN)).toBe(LIVE.defaultIntervalSec)
        expect(clampIntervalSec(undefined)).toBe(LIVE.defaultIntervalSec)
        expect(clampIntervalSec('5')).toBe(LIVE.defaultIntervalSec)
    })
})

describe('clampPollSec', () => {
    it('kẹp vào [30, 600] và mặc định 120', () => {
        expect(clampPollSec(5)).toBe(30)
        expect(clampPollSec(120)).toBe(120)
        expect(clampPollSec(9999)).toBe(600)
        expect(clampPollSec(null)).toBe(120)
    })
})

describe('clientMessageSchema', () => {
    it('chấp nhận hello cho danh sách và cho một liên kết, và hb', () => {
        expect(clientMessageSchema.safeParse({ t: 'hello', scope: 'links' }).success).toBe(true)
        expect(clientMessageSchema.safeParse({ t: 'hello', scope: 'link', id: 7 }).success).toBe(true)
        expect(clientMessageSchema.safeParse({ t: 'hb' }).success).toBe(true)
    })

    it('từ chối tin lạ, scope link thiếu id, id không dương', () => {
        expect(clientMessageSchema.safeParse({ t: 'x' }).success).toBe(false)
        expect(clientMessageSchema.safeParse({ t: 'hello', scope: 'link' }).success).toBe(false)
        expect(clientMessageSchema.safeParse({ t: 'hello', scope: 'link', id: 0 }).success).toBe(false)
        expect(clientMessageSchema.safeParse({ t: 'hello', scope: 'all' }).success).toBe(false)
    })
})

describe('serverMessageSchema', () => {
    it('chấp nhận đủ các loại tin', () => {
        const msgs = [
            { t: 'snapshot', server_time: 1, links: [{ id: 1, live_state: 'live', sample }] },
            { t: 'samples', id: 1, server_time: 1, samples: [sample] },
            { t: 'positions', id: 1, server_time: 1, positions: [], pos_hash: 'ab' },
            { t: 'live_state', id: 1, server_time: 1, state: 'waking' },
            { t: 'kick', reason: 'too_many_tabs' },
        ]
        for (const m of msgs) expect(serverMessageSchema.safeParse(m).success).toBe(true)
    })

    it('từ chối trạng thái, lý do kick lạ và lô samples rỗng', () => {
        expect(
            serverMessageSchema.safeParse({ t: 'live_state', id: 1, server_time: 1, state: 'zzz' })
                .success,
        ).toBe(false)
        expect(serverMessageSchema.safeParse({ t: 'kick', reason: 'bored' }).success).toBe(false)
        expect(
            serverMessageSchema.safeParse({ t: 'samples', id: 1, server_time: 1, samples: [] }).success,
        ).toBe(false)
    })
})