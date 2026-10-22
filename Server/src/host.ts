import os from 'node:os'
import type { HostHooks } from '../../BE/src/types'
import { APP_VERSION } from '../../BE/src/lib/version'
import type { ServerNode, StandbyStatus } from '@az-sentinel/shared'
import type { ServerConfig } from './config'

const BOOT_SEC = Math.floor(Date.now() / 1000)

/** Đo CPU dùng (%) bằng chênh lệch bộ đếm giữa hai lần lấy mẫu; null cho tới khi có hai mẫu. */
export class CpuMeter {
    private last: { idle: number; total: number } | null = null
    private pct: number | null = null
    private timer: NodeJS.Timeout | null = null

    start(everyMs = 5000): void {
        this.sample()
        this.timer = setInterval(() => this.sample(), everyMs)
        this.timer.unref()
    }

    stop(): void {
        if (this.timer) clearInterval(this.timer)
        this.timer = null
    }

    value(): number | null {
        return this.pct
    }

    private sample(): void {
        let idle = 0
        let total = 0
        for (const c of os.cpus()) {
            idle += c.times.idle
            total += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq
        }
        if (this.last && total > this.last.total) {
            const busy = 1 - (idle - this.last.idle) / (total - this.last.total)
            this.pct = Math.round(Math.min(1, Math.max(0, busy)) * 1000) / 10
        }
        this.last = { idle, total }
    }
}

/** Thông tin node VPS hiển thị trên UI (không chứa bí mật). */
export function describeNode(cfg: ServerConfig, cpu: CpuMeter): ServerNode {
    const mb = (bytes: number) => Math.round(bytes / (1024 * 1024))
    const now = Math.floor(Date.now() / 1000)
    return {
        role: 'vps',
        name: cfg.name,
        host: os.hostname().slice(0, 128),
        os: (typeof os.version === 'function' ? os.version() : `${os.type()} ${os.release()}`).slice(0, 128),
        arch: os.arch(),
        runtime: `node ${process.version}`,
        version: APP_VERSION,
        startedAt: BOOT_SEC,
        uptimeSec: Math.max(0, now - BOOT_SEC),
        cpuCount: os.cpus().length || null,
        memTotalMb: mb(os.totalmem()),
        memFreeMb: mb(os.freemem()),
        cpuPct: cpu.value(),
        location: cfg.location === '' ? null : cfg.location,
    }
}

export function createHostHooks(
    cfg: ServerConfig,
    cpu: CpuMeter,
    standby: () => StandbyStatus | null,
): HostHooks {
    return {
        role: 'vps',
        describe: () => describeNode(cfg, cpu),
        standby,
        fallbackUrl: cfg.fallbackUrl === '' ? null : cfg.fallbackUrl,
    }
}