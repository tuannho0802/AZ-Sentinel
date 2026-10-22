import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type Logger = Record<LogLevel, (msg: string) => void>
const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

/**
 * Logger ra console và tệp xoay vòng (`server.log`, `server.1.log`... mặc định 5 tệp x 2 MB).
 * Chạy nền không có cửa sổ nên tệp log là nơi xem lỗi. Lỗi ghi tệp bị nuốt để log hỏng không làm
 * máy chủ chết. Không bao giờ truyền token hay khóa API vào đây.
 */
export function createLogger(level: LogLevel, dir: string | null): Logger {
    const maxBytes = 2_000_000
    const files = 5
    const name = (i: number) => path.join(dir ?? '.', i === 0 ? 'server.log' : `server.${i}.log`)
    let size = 0
    if (dir) {
        try {
            mkdirSync(dir, { recursive: true })
            size = existsSync(name(0)) ? statSync(name(0)).size : 0
        } catch {
            // thử lại ở lần ghi sau
        }
    }
    const rotate = () => {
        try {
            rmSync(name(files - 1), { force: true })
            for (let i = files - 2; i >= 0; i--) if (existsSync(name(i))) renameSync(name(i), name(i + 1))
        } catch {
            // bỏ qua
        }
        size = 0
    }
    const make = (l: LogLevel) => (msg: string) => {
        if (ORDER[l] < ORDER[level]) return
        const line = `${new Date().toISOString()} ${l.toUpperCase()} ${msg}`
        if (l === 'warn' || l === 'error') console.error(line)
        else console.log(line)
        if (!dir) return
        try {
            if (size >= maxBytes) rotate()
            appendFileSync(name(0), `${line}\n`)
            size += Buffer.byteLength(line) + 1
        } catch {
            // bỏ qua
        }
    }
    return { debug: make('debug'), info: make('info'), warn: make('warn'), error: make('error') }
}