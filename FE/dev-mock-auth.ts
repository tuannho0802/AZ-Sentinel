/**
 * GIẢ LẬP ĐĂNG NHẬP CHỈ CHO `pnpm dev` (apply: 'serve': không bao giờ vào bản build).
 * BE chưa có xác thực (Part 2), nên plugin này chặn /api/auth/* và /api/me ở dev server để thử UI.
 * Tài khoản dưới đây là dữ liệu giả, KHÔNG phải đăng nhập thật. Tắt: AZ_MOCK_AUTH=0 pnpm dev.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

const USERS: Record<
  string,
  { password: string; id: number; display_name: string; role: string; status: string }
> = {
  'admin@az.local': {
    password: 'admin1234',
    id: 1,
    display_name: 'Root Admin (giả lập)',
    role: 'root_admin',
    status: 'active',
  },
  'user@az.local': {
    password: 'user1234',
    id: 2,
    display_name: 'Người dùng (giả lập)',
    role: 'user',
    status: 'active',
  },
  'pending@az.local': {
    password: 'pending1234',
    id: 3,
    display_name: 'Chờ duyệt (giả lập)',
    role: 'user',
    status: 'pending',
  },
}

const COOKIE = 'az_mock_session'
const MAX_FAILURES = 5
const LOCK_MS = 30_000
let failures = 0
let lockedUntil = 0

function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
  res.end(JSON.stringify(body))
}

const err = (res: ServerResponse, status: number, code: string, message: string) =>
  send(res, status, { error: { code, message } })

function sessionEmail(req: IncomingMessage): string | null {
  const match = (req.headers.cookie ?? '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`))
  const email = match?.[1] ? decodeURIComponent(match[1]) : null
  const user = email ? USERS[email] : undefined
  return user && user.status === 'active' ? email : null
}

function publicUser(email: string) {
  const { id, display_name, role } = USERS[email] as (typeof USERS)[string]
  return { id, email, display_name, role }
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += String(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw))
      } catch {
        resolve(null)
      }
    })
  })
}

export function mockAuth(): Plugin {
  return {
    name: 'az-mock-auth',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url ?? '').split('?')[0]
        if (url === '/api/me' && req.method === 'GET') {
          const email = sessionEmail(req)
          if (!email) return err(res, 401, 'UNAUTHENTICATED', 'Chưa đăng nhập')
          return send(res, 200, publicUser(email))
        }
        if (url === '/api/auth/logout' && req.method === 'POST') {
          return send(
            res,
            200,
            { ok: true },
            { 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; Max-Age=0` },
          )
        }
        if (url === '/api/auth/login' && req.method === 'POST') {
          const body = (await readJson(req)) as { email?: unknown; password?: unknown } | null
          if (typeof body?.email !== 'string' || typeof body?.password !== 'string') {
            return err(res, 400, 'VALIDATION_FAILED', 'Dữ liệu không hợp lệ')
          }
          if (Date.now() < lockedUntil) {
            return err(
              res,
              429,
              'RATE_LIMITED',
              'Thử đăng nhập quá nhiều lần. Hãy thử lại sau 30 giây.',
            )
          }
          const user = USERS[body.email.toLowerCase()]
          if (!user || user.password !== body.password) {
            failures += 1
            if (failures >= MAX_FAILURES) {
              failures = 0
              lockedUntil = Date.now() + LOCK_MS
            }
            return err(res, 401, 'UNAUTHENTICATED', 'Email hoặc mật khẩu không đúng')
          }
          if (user.status !== 'active') {
            return err(res, 403, 'FORBIDDEN', 'Tài khoản đang chờ quản trị viên duyệt')
          }
          failures = 0
          const email = body.email.toLowerCase()
          return send(res, 200, publicUser(email), {
            'Set-Cookie': `${COOKIE}=${encodeURIComponent(email)}; Path=/; HttpOnly; SameSite=Lax`,
          })
        }
        next()
      })
    },
  }
}
