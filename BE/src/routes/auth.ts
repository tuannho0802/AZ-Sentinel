import { loginRequestSchema, type MeResponse } from '@az-sentinel/shared'
import { zValidator } from '@hono/zod-validator'
import { type Context, Hono } from 'hono'
import { AppError, errorBody } from '../lib/app-error'
import { readCookie } from '../lib/cookies'
import { hashPassword, verifyPassword } from '../lib/password'
import { nowUnix } from '../lib/time'
import { resolveViewer, type ViewerAuth } from '../live/viewer-auth'
import {
  clearSessionCookie,
  createSession,
  deleteSession,
  SESSION_COOKIE,
  SESSION_TTL_SEC,
  sessionCookie,
} from '../services/session-service'
import {
  clearFailedLogins,
  findUserByEmail,
  getUserById,
  registerFailedLogin,
  registerUnknownFailedLogin,
  type UserRow,
  unknownLoginLockWait,
} from '../services/user-service'
import type { AppEnv } from '../types'

const BAD_CREDENTIALS = 'Email hoặc mật khẩu không đúng'

/** Chuỗi băm giả để mất thời gian như thật khi email không tồn tại (không lộ email nào có tài khoản). */
let dummyHash: Promise<string> | null = null
const getDummyHash = () => {
  dummyHash ??= hashPassword('khong-co-nguoi-dung-nay')
  return dummyHash
}

/** Request tới qua HTTPS (trực tiếp, qua Worker hoặc qua Cloudflare Tunnel) thì cookie gắn `Secure`. */
function isSecure(c: Context<AppEnv>): boolean {
  if (new URL(c.req.url).protocol === 'https:') return true
  if (c.req.header('X-Forwarded-Proto')?.split(',')[0]?.trim() === 'https') return true
  return (c.req.header('Cf-Visitor') ?? '').includes('"https"')
}

const toMe = (u: UserRow): MeResponse => ({
  id: u.id,
  email: u.email,
  display_name: u.display_name,
  role: u.role,
})

function requireJson(c: Context<AppEnv>): void {
  const type = c.req.header('Content-Type') ?? ''
  if (!type.toLowerCase().includes('application/json')) {
    throw new AppError(400, 'VALIDATION_FAILED', 'Cần Content-Type: application/json')
  }
}

/** 429 khi bị khóa tạm; dùng chung cho tài khoản thật và email không tồn tại để hai bên trả y hệt nhau. */
function lockedError(waitSec: number): AppError {
  return new AppError(
    429,
    'RATE_LIMITED',
    `Thử đăng nhập quá nhiều lần. Hãy thử lại sau ${Math.ceil(waitSec / 60)} phút.`,
    waitSec,
  )
}

/**
 * Đăng nhập thật (Plan 4B): `POST /auth/login`, `POST /auth/logout`, `GET /me`. Cookie phiên HttpOnly,
 * SameSite=Lax. Ghi bắt buộc JSON để trang web lạ không kích hoạt được qua form. Sai quá
 * `MAX_FAILED_LOGINS` lần thì khóa tạm tài khoản đó; chặn theo IP là việc của luật rate limit ở Cloudflare.
 */
export function createAuthRoutes(viewerAuth: ViewerAuth = resolveViewer) {
  const routes = new Hono<AppEnv>()

  routes.post(
    '/auth/login',
    async (c, next) => {
      requireJson(c)
      await next()
    },
    zValidator('json', loginRequestSchema, (result, c) => {
      if (!result.success)
        return c.json(errorBody('VALIDATION_FAILED', 'Dữ liệu không hợp lệ'), 400)
    }),
    async (c) => {
      const { email, password } = c.req.valid('json')
      const db = c.env.DB
      const now = nowUnix()
      c.header('Cache-Control', 'no-store')

      const user = await findUserByEmail(db, email)
      if (!user) {
        // Email không tồn tại phải bị đếm và khóa y hệt tài khoản thật (cùng thứ tự: kiểm khóa trước, so mật khẩu sau).
        const wait = await unknownLoginLockWait(db, email, now)
        if (wait > 0) throw lockedError(wait)
        await verifyPassword(password, await getDummyHash())
        await registerUnknownFailedLogin(db, email, now)
        throw new AppError(401, 'UNAUTHENTICATED', BAD_CREDENTIALS)
      }
      if (user.locked_until !== null && user.locked_until > now) {
        throw lockedError(user.locked_until - now)
      }
      if (!(await verifyPassword(password, user.password_hash))) {
        await registerFailedLogin(db, user, now)
        throw new AppError(401, 'UNAUTHENTICATED', BAD_CREDENTIALS)
      }
      // Kiểm trạng thái SAU khi đúng mật khẩu để không lộ trạng thái của tài khoản cho người lạ.
      if (user.status === 'pending') {
        throw new AppError(403, 'FORBIDDEN', 'Tài khoản đang chờ quản trị viên duyệt')
      }
      if (user.status !== 'active') {
        throw new AppError(403, 'FORBIDDEN', 'Tài khoản đã bị khóa. Hãy liên hệ quản trị viên')
      }
      await clearFailedLogins(db, user)
      const session = await createSession(db, user.id, now)
      c.header('Set-Cookie', sessionCookie(session.token, SESSION_TTL_SEC, isSecure(c)))
      return c.json(toMe(user))
    },
  )

  routes.post('/auth/logout', async (c) => {
    const token = readCookie(c.req.header('Cookie'), SESSION_COOKIE)
    if (token) await deleteSession(c.env.DB, token)
    c.header('Set-Cookie', clearSessionCookie(isSecure(c)))
    c.header('Cache-Control', 'no-store')
    return c.json({ ok: true })
  })

  routes.get('/me', async (c) => {
    c.header('Cache-Control', 'no-store')
    const viewer = await viewerAuth(c)
    const user = viewer ? await getUserById(c.env.DB, viewer.userId) : null
    if (user?.status !== 'active') {
      throw new AppError(401, 'UNAUTHENTICATED', 'Chưa đăng nhập')
    }
    return c.json(toMe(user))
  })

  return routes
}
