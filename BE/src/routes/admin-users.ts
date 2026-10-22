import {
    createUserRequestSchema,
    type UserListResponse,
    type UserResponse,
    updateUserRequestSchema,
} from '@az-sentinel/shared'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { AppError, errorBody } from '../lib/app-error'
import { nowUnix } from '../lib/time'
import type { Viewer, ViewerAuth } from '../live/viewer-auth'
import { deleteUserSessions } from '../services/session-service'
import { revokeToken } from '../services/gw-token-service'
import {
    createUser,
    getUserById,
    hasActiveToken,
    listUsers,
    setPassword,
    toSummary,
    updateUser,
    type UserRow,
} from '../services/user-service'
import type { AppEnv } from '../types'
import { dropTokenAtHub } from './admin-tokens'

type AdminEnv = AppEnv & { Variables: AppEnv['Variables'] & { viewer: Viewer } }

const parseId = (raw: string): number => {
    const id = Number(raw)
    if (!Number.isInteger(id) || id <= 0) {
        throw new AppError(400, 'VALIDATION_FAILED', 'id không hợp lệ')
    }
    return id
}

const forbid = (message: string) => new AppError(403, 'FORBIDDEN', message)

/** Quản trị viên thường (`admin`) chỉ được sửa người dùng thường; sửa admin khác là việc của `root_admin`. */
function assertCanManage(actor: Viewer, target: UserRow): void {
    if (actor.role === 'root_admin') return
    if (target.role !== 'user') throw forbid('Chỉ quản trị viên gốc được sửa tài khoản quản trị')
}

/**
 * Quản lý người dùng (Plan 4B), CHỈ quản trị viên:
 * - `GET /`: danh sách (kèm `has_token`).
 * - `POST /`: tạo người dùng; chỉ `root_admin` được tạo `admin`.
 * - `PATCH /:id`: đổi tên, vai trò, trạng thái, đặt lại mật khẩu. Không tự đổi vai trò/trạng thái của mình,
 *   không đụng tới `root_admin`. Khóa hoặc từ chối một người thì phiên của họ bị xóa và token Gateway bị thu hồi.
 * Xác thực qua `viewerAuth`; ghi bắt buộc JSON; phản hồi `no-store`.
 */
export function createAdminUserRoutes(viewerAuth: ViewerAuth) {
    const routes = new Hono<AdminEnv>()

    routes.use('*', async (c, next) => {
        const viewer = await viewerAuth(c)
        if (!viewer) throw new AppError(401, 'UNAUTHENTICATED', 'Chưa đăng nhập')
        if (viewer.role !== 'admin' && viewer.role !== 'root_admin') {
            throw new AppError(403, 'FORBIDDEN', 'Chỉ quản trị viên được quản lý người dùng')
        }
        const method = c.req.method
        if (method !== 'GET' && method !== 'HEAD') {
            const type = c.req.header('Content-Type') ?? ''
            if (!type.toLowerCase().includes('application/json')) {
                throw new AppError(400, 'VALIDATION_FAILED', 'Cần Content-Type: application/json')
            }
        }
        c.set('viewer', viewer)
        c.header('Cache-Control', 'no-store')
        await next()
    })

    routes.get('/', async (c) => {
        return c.json({ users: await listUsers(c.env.DB) } satisfies UserListResponse)
    })

    routes.post(
        '/',
        zValidator('json', createUserRequestSchema, (result, c) => {
            if (!result.success) {
                return c.json(
                    errorBody('VALIDATION_FAILED', 'Dữ liệu không hợp lệ (mật khẩu tối thiểu 10 ký tự)'),
                    400,
                )
            }
        }),
        async (c) => {
            const body = c.req.valid('json')
            if (body.role === 'admin' && c.get('viewer').role !== 'root_admin') {
                throw forbid('Chỉ quản trị viên gốc được tạo tài khoản quản trị')
            }
            const row = await createUser(
                c.env.DB,
                {
                    email: body.email,
                    displayName: body.display_name,
                    password: body.password,
                    role: body.role,
                },
                nowUnix(),
            )
            return c.json({ user: toSummary(row, false) } satisfies UserResponse, 201)
        },
    )

    routes.patch(
        '/:id',
        zValidator('json', updateUserRequestSchema, (result, c) => {
            if (!result.success) {
                return c.json(
                    errorBody('VALIDATION_FAILED', 'Dữ liệu không hợp lệ (mật khẩu tối thiểu 10 ký tự)'),
                    400,
                )
            }
        }),
        async (c) => {
            const db = c.env.DB
            const actor = c.get('viewer')
            const id = parseId(c.req.param('id'))
            const body = c.req.valid('json')
            const target = await getUserById(db, id)
            if (!target) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy người dùng')

            const self = target.id === actor.userId
            const changesAccess = body.role !== undefined || body.status !== undefined
            if (changesAccess && self) throw forbid('Không thể đổi vai trò hoặc trạng thái của chính mình')
            if (changesAccess && target.role === 'root_admin') {
                throw forbid('Không thể đổi vai trò hoặc trạng thái của quản trị viên gốc')
            }
            if (!self) assertCanManage(actor, target)
            if (body.role === 'admin' && actor.role !== 'root_admin') {
                throw forbid('Chỉ quản trị viên gốc được cấp quyền quản trị')
            }

            const updated = await updateUser(db, id, {
                displayName: body.display_name,
                role: body.role,
                status: body.status,
            })
            if (!updated) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy người dùng')

            if (body.password !== undefined) {
                await setPassword(db, id, body.password)
                await deleteUserSessions(db, id)
            }
            if (body.status !== undefined && body.status !== 'active') {
                await deleteUserSessions(db, id)
                const token = await db
                    .prepare(`SELECT id FROM gw_tokens WHERE owner_id = ? AND status = 'active'`)
                    .bind(id)
                    .first<{ id: number }>()
                if (token) {
                    const revoked = await revokeToken(db, token.id, nowUnix())
                    if (revoked) await dropTokenAtHub(c.env, revoked)
                }
            }
            return c.json({ user: toSummary(updated, await hasActiveToken(db, id)) } satisfies UserResponse)
        },
    )

    return routes
}