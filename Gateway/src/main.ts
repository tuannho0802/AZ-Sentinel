import path from 'node:path'
import { CloudClient } from './cloud'
import { loadConfig } from './config'
import { Gateway } from './gateway'
import { LocalServer } from './local-server'
import { createLogger } from './log'
import { EventQueue } from './queue'

async function main() {
    const cfg = loadConfig()
    const log = createLogger(cfg.logLevel)
    const queue = new EventQueue(path.join(cfg.dataDir, 'queue.json'))
    const gw = new Gateway({ vps: cfg.vps, queue, log, cloudConfigured: cfg.cloudUrl !== '' })
    const local = new LocalServer(gw, cfg.port, log)

    await local.start()
    gw.start()

    let cloud: CloudClient | null = null
    if (cfg.cloudUrl) {
        cloud = new CloudClient(gw, { url: cfg.cloudUrl, log })
        cloud.start()
    } else {
        log.warn('chưa cấu hình cloudUrl: chỉ chạy cục bộ, không có live')
    }

    const shutdown = async () => {
        log.info('đang dừng Gateway')
        cloud?.stop()
        gw.stop()
        await local.stop()
        process.exit(0)
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
}

main().catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
})