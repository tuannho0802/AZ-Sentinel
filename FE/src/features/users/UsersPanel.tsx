import { createUserRequestSchema, type UserSummary } from '@az-sentinel/shared'
import { type FormEvent, useState } from 'react'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { Dialog } from '../../components/Dialog'
import { inputClass } from '../../components/styles'
import { ApiError } from '../../lib/api-client'
import { formatDateTime } from '../../lib/format'
import { strings } from '../../lib/strings'
import { useMe } from '../auth/api'
import { useCreateUser, useUpdateUser, useUsers } from './api'

const ROLE_LABEL = {
    root_admin: strings.userRoleRoot,
    admin: strings.userRoleAdmin,
    user: strings.userRoleUser,
} as const

const STATUS_LABEL = {
    active: strings.userStatusActive,
    pending: strings.userStatusPending,
    rejected: strings.userStatusRejected,
    suspended: strings.userStatusSuspended,
} as const

type FieldError = { field: 'email' | 'name' | 'password' | 'server'; text: string }

function CreateForm({ canCreateAdmin }: { canCreateAdmin: boolean }) {
    const create = useCreateUser()
    const [email, setEmail] = useState('')
    const [name, setName] = useState('')
    const [password, setPassword] = useState('')
    const [role, setRole] = useState<'user' | 'admin'>('user')
    const [error, setError] = useState<FieldError | null>(null)

    function onSubmit(e: FormEvent) {
        e.preventDefault()
        const parsed = createUserRequestSchema.safeParse({
            email: email.trim(),
            display_name: name,
            password,
            role,
        })
        if (!parsed.success) {
            const first = parsed.error.issues[0]?.path[0]
            setError(
                first === 'email'
                    ? { field: 'email', text: strings.userEmailInvalid }
                    : first === 'display_name'
                        ? { field: 'name', text: strings.userNameRequired }
                        : { field: 'password', text: strings.userPasswordShort },
            )
            return
        }
        setError(null)
        create.mutate(parsed.data, {
            onSuccess: () => {
                setEmail('')
                setName('')
                setPassword('')
                setRole('user')
                create.reset()
            },
            onError: (err) =>
                setError({
                    field: 'server',
                    text:
                        err instanceof ApiError && [403, 409].includes(err.status)
                            ? err.message
                            : strings.userCreateFailed,
                }),
        })
    }

    return (
        <form noValidate onSubmit={onSubmit} className="flex flex-wrap items-start gap-3">
            <div className="min-w-52 flex-1">
                <label className="block text-sm font-medium" htmlFor="user-email">
                    {strings.userEmail}
                </label>
                <input
                    id="user-email"
                    type="email"
                    autoComplete="off"
                    value={email}
                    aria-invalid={error?.field === 'email'}
                    onChange={(e) => setEmail(e.target.value)}
                    className={`${inputClass} mt-1`}
                />
            </div>
            <div className="min-w-44 flex-1">
                <label className="block text-sm font-medium" htmlFor="user-name">
                    {strings.userDisplayName}
                </label>
                <input
                    id="user-name"
                    autoComplete="off"
                    maxLength={64}
                    value={name}
                    aria-invalid={error?.field === 'name'}
                    onChange={(e) => setName(e.target.value)}
                    className={`${inputClass} mt-1`}
                />
            </div>
            <div className="min-w-52 flex-1">
                <label className="block text-sm font-medium" htmlFor="user-password">
                    {strings.userPassword}
                </label>
                <input
                    id="user-password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    aria-invalid={error?.field === 'password'}
                    onChange={(e) => setPassword(e.target.value)}
                    className={`${inputClass} mt-1`}
                />
            </div>
            {canCreateAdmin && (
                <div className="w-44">
                    <label className="block text-sm font-medium" htmlFor="user-role">
                        {strings.userRole}
                    </label>
                    <select
                        id="user-role"
                        value={role}
                        onChange={(e) => setRole(e.target.value === 'admin' ? 'admin' : 'user')}
                        className={`${inputClass} mt-1`}
                    >
                        <option value="user">{strings.userRoleUser}</option>
                        <option value="admin">{strings.userRoleAdmin}</option>
                    </select>
                </div>
            )}
            <div className="pt-[1.375rem]">
                <Button type="submit" variant="primary" disabled={create.isPending}>
                    {strings.userCreate}
                </Button>
            </div>
            {error && (
                <p role="alert" className="basis-full text-sm text-loss">
                    {error.text}
                </p>
            )}
        </form>
    )
}

function PasswordDialog({ user, onClose }: { user: UserSummary; onClose: () => void }) {
    const update = useUpdateUser()
    const [password, setPassword] = useState('')
    const [error, setError] = useState<string | null>(null)

    function save() {
        if (password.length < 10 || password.length > 128) {
            setError(strings.userPasswordShort)
            return
        }
        setError(null)
        update.mutate({ id: user.id, password }, { onSuccess: onClose, onError: () => setError(strings.userActionFailed) })
    }

    return (
        <Dialog
            title={`${strings.userPasswordDialogTitle}: ${user.display_name}`}
            onClose={onClose}
            footer={
                <>
                    <Button onClick={onClose}>{strings.close}</Button>
                    <Button variant="primary" disabled={update.isPending} onClick={save}>
                        {strings.userPasswordSave}
                    </Button>
                </>
            }
        >
            <p className="text-sm text-muted">{strings.userPasswordDialogHint}</p>
            <label className="mt-3 block text-sm font-medium" htmlFor="user-new-password">
                {strings.userPassword}
            </label>
            <input
                id="user-new-password"
                type="password"
                autoComplete="new-password"
                value={password}
                aria-invalid={error !== null}
                onChange={(e) => setPassword(e.target.value)}
                className={`${inputClass} mt-1`}
            />
            {error && (
                <p role="alert" className="mt-2 text-sm text-loss">
                    {error}
                </p>
            )}
        </Dialog>
    )
}

function Row({
    u,
    meId,
    canManage,
    onPassword,
}: {
    u: UserSummary
    meId: number | undefined
    canManage: boolean
    onPassword: (u: UserSummary) => void
}) {
    const update = useUpdateUser()
    const self = u.id === meId
    const locked = u.role === 'root_admin' || self
    const busy = update.isPending

    function setStatus(status: 'active' | 'suspended') {
        if (status === 'suspended' && !window.confirm(strings.userConfirmSuspend)) return
        update.mutate({ id: u.id, status })
    }

    return (
        <tr className="border-t border-line align-middle">
            <td className="px-3 py-2">
                <div className="font-medium">{u.display_name}</div>
                <div className="text-xs text-muted">{u.email}</div>
            </td>
            <td className="px-3 py-2 text-sm">{ROLE_LABEL[u.role]}</td>
            <td className="px-3 py-2 text-sm">{STATUS_LABEL[u.status]}</td>
            <td className="px-3 py-2 text-sm text-muted">
                {u.has_token ? strings.userHasToken : strings.userNoToken}
            </td>
            <td className="px-3 py-2 text-sm text-muted">{formatDateTime(u.created_at)}</td>
            <td className="px-3 py-2">
                {canManage && (
                    <div className="flex flex-wrap items-center gap-2">
                        {!locked && u.status === 'pending' && (
                            <Button size="sm" variant="primary" disabled={busy} onClick={() => setStatus('active')}>
                                {strings.userApprove}
                            </Button>
                        )}
                        {!locked && u.status === 'active' && (
                            <Button size="sm" variant="danger" disabled={busy} onClick={() => setStatus('suspended')}>
                                {strings.userSuspend}
                            </Button>
                        )}
                        {!locked && (u.status === 'suspended' || u.status === 'rejected') && (
                            <Button size="sm" disabled={busy} onClick={() => setStatus('active')}>
                                {strings.userReactivate}
                            </Button>
                        )}
                        <Button size="sm" disabled={busy} onClick={() => onPassword(u)}>
                            {strings.userResetPassword}
                        </Button>
                        {update.isError && (
                            <span role="alert" className="text-xs text-loss">
                                {update.error instanceof ApiError && update.error.status === 403
                                    ? update.error.message
                                    : strings.userActionFailed}
                            </span>
                        )}
                    </div>
                )}
            </td>
        </tr>
    )
}

/** Trang quản lý người dùng (chỉ quản trị viên): thêm, duyệt, khóa, đặt lại mật khẩu. */
export function UsersPanel() {
    const users = useUsers()
    const me = useMe()
    const [passwordFor, setPasswordFor] = useState<UserSummary | null>(null)
    const forbidden = users.error instanceof ApiError && users.error.status === 403
    const isRoot = me.data?.role === 'root_admin'

    return (
        <div className="space-y-4">
            <div>
                <h1 className="text-xl font-semibold">{strings.usersTitle}</h1>
                <p className="mt-1 max-w-3xl text-sm text-muted">{strings.usersHint}</p>
            </div>

            {forbidden ? (
                <p role="alert" className="rounded-md bg-notice-bg px-3 py-2 text-sm text-notice-ink">
                    {strings.usersForbidden}
                </p>
            ) : (
                <>
                    <Card title={strings.userCreateTitle}>
                        <CreateForm canCreateAdmin={isRoot} />
                    </Card>
                    <Card title={strings.usersTitle}>
                        {users.isPending && <p className="text-sm text-muted">{strings.usersLoading}</p>}
                        {users.isError && (
                            <p role="alert" className="text-sm text-loss">
                                {strings.usersError}{' '}
                                <Button size="sm" onClick={() => users.refetch()}>
                                    {strings.retry}
                                </Button>
                            </p>
                        )}
                        {users.data && users.data.users.length === 0 && (
                            <p className="text-sm text-muted">{strings.usersEmpty}</p>
                        )}
                        {users.data && users.data.users.length > 0 && (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                    <thead className="text-xs text-muted">
                                        <tr>
                                            <th className="px-3 py-1.5 font-medium">{strings.userColUser}</th>
                                            <th className="px-3 py-1.5 font-medium">{strings.userColRole}</th>
                                            <th className="px-3 py-1.5 font-medium">{strings.userColStatus}</th>
                                            <th className="px-3 py-1.5 font-medium">{strings.userColToken}</th>
                                            <th className="px-3 py-1.5 font-medium">{strings.userColCreated}</th>
                                            <th className="px-3 py-1.5 font-medium">{strings.userColActions}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {users.data.users.map((u) => (
                                            <Row
                                                key={u.id}
                                                u={u}
                                                meId={me.data?.id}
                                                canManage={isRoot || u.role === 'user'}
                                                onPassword={setPasswordFor}
                                            />
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </Card>
                </>
            )}

            {passwordFor && <PasswordDialog user={passwordFor} onClose={() => setPasswordFor(null)} />}
        </div>
    )
}