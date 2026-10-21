export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

export type Logger = Record<LogLevel, (msg: string) => void>

/** Logger tối giản ra stdout/stderr. Không bao giờ truyền API key vào đây. */
export function createLogger(level: LogLevel = 'info', sink = defaultSink): Logger {
  const make = (l: LogLevel) => (msg: string) => {
    if (ORDER[l] >= ORDER[level]) sink(l, `${new Date().toISOString()} ${l.toUpperCase()} ${msg}`)
  }
  return { debug: make('debug'), info: make('info'), warn: make('warn'), error: make('error') }
}

function defaultSink(level: LogLevel, line: string) {
  if (level === 'warn' || level === 'error') console.error(line)
  else console.log(line)
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} }
