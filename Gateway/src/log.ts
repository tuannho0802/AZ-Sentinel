import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

export type Logger = Record<LogLevel, (msg: string) => void>
export type LogSink = (level: LogLevel, line: string) => void

/** Logger tối giản ra stdout/stderr. Không bao giờ truyền API key vào đây. */
export function createLogger(level: LogLevel = 'info', sink: LogSink = defaultSink): Logger {
  const make = (l: LogLevel) => (msg: string) => {
    if (ORDER[l] >= ORDER[level]) sink(l, `${new Date().toISOString()} ${l.toUpperCase()} ${msg}`)
  }
  return { debug: make('debug'), info: make('info'), warn: make('warn'), error: make('error') }
}

function defaultSink(level: LogLevel, line: string) {
  if (level === 'warn' || level === 'error') console.error(line)
  else console.log(line)
}

/**
 * Sink ghi file xoay vòng (mặc định 5 tệp × 1 MB: `gateway.log`, `gateway.1.log` ... `gateway.4.log`).
 * Chạy như tác vụ nền không có cửa sổ console nên log file là nơi duy nhất xem được lỗi.
 * Lỗi ghi file bị nuốt: log hỏng không được làm Gateway chết.
 */
export function createFileSink(
  dir: string,
  opts: { maxBytes?: number; files?: number; alsoConsole?: boolean } = {},
): LogSink {
  const maxBytes = opts.maxBytes ?? 1_000_000
  const files = Math.max(2, opts.files ?? 5)
  const name = (i: number) => path.join(dir, i === 0 ? 'gateway.log' : `gateway.${i}.log`)
  let size = 0
  try {
    mkdirSync(dir, { recursive: true })
    size = existsSync(name(0)) ? statSync(name(0)).size : 0
  } catch {
    // bỏ qua: sẽ thử lại ở lần ghi sau
  }
  const rotate = () => {
    try {
      rmSync(name(files - 1), { force: true })
      for (let i = files - 2; i >= 0; i--) {
        if (existsSync(name(i))) renameSync(name(i), name(i + 1))
      }
    } catch {
      // bỏ qua
    }
    size = 0
  }
  return (level, line) => {
    if (opts.alsoConsole) defaultSink(level, line)
    try {
      if (size >= maxBytes) rotate()
      appendFileSync(name(0), `${line}\n`)
      size += Buffer.byteLength(line) + 1
    } catch {
      // bỏ qua
    }
  }
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} }
