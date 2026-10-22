import type { GwTokenSummary } from '@az-sentinel/shared'
import { type FormEvent, useState } from 'react'
import { Link } from 'wouter'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { inputClass } from '../../components/styles'
import { ApiError } from '../../lib/api-client'
import { formatDateTime, formatRelative } from '../../lib/format'
import { strings } from '../../lib/strings'
import { useUsers } from '../users/api'
import { useIssueToken, useResetToken, useRevokeToken, useTokens } from './api'
import { TokenSecretDialog } from './TokenSecretDialog'

type Revealed = { token: string; title: string }

function IssueForm({ onIssued }: { onIssued: (r: Revealed) => void }) {
  const issue = useIssueToken()
  const users = useUsers()
  const [ownerId, setOwnerId] = useState('')
  const [error, setError] = useState<{ field: 'owner' | 'server'; text: string } | null>(null)
  // Chỉ người đang hoạt động và chưa có token mới cần cấp (mỗi người một token).
  const eligible = (users.data?.users ?? []).filter((u) => u.status === 'active' && !u.has_token)

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const id = Number(ownerId)
    if (!Number.isInteger(id) || id <= 0) {
      setError({ field: 'owner', text: strings.tokenPickRequired })
      return
    }
    setError(null)
    issue.mutate(
      { owner_id: id },
      {
        onSuccess: (res) => {
          onIssued({ token: res.token, title: strings.tokenDialogIssue })
          issue.reset()
          setOwnerId('')
        },
        onError: (err) =>
          setError({
            field: 'server',
            text:
              err instanceof ApiError && err.status === 409
                ? strings.tokenIssueConflict
                : err instanceof ApiError && err.status === 404
                  ? strings.tokenIssueNotFound
                  : strings.tokenIssueFailed,
          }),
      },
    )
  }

  if (users.isPending) return <p className="text-sm text-muted">{strings.usersLoading}</p>
  if (users.isError) {
    return (
      <p role="alert" className="text-sm text-loss">
        {strings.tokenUsersError}{' '}
        <Button size="sm" onClick={() => users.refetch()}>
          {strings.retry}
        </Button>
      </p>
    )
  }
  if (eligible.length === 0) {
    return (
      <p className="text-sm text-muted">
        {strings.tokenNoEligible}{' '}
        <Link href="/users" className="font-medium text-accent-text underline underline-offset-2">
          {strings.tokenGoUsers}
        </Link>
      </p>
    )
  }

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-wrap items-start gap-3">
      <div className="min-w-64 flex-1">
        <label className="block text-sm font-medium" htmlFor="gw-owner">
          {strings.tokenPickUser}
        </label>
        <select
          id="gw-owner"
          value={ownerId}
          aria-invalid={error?.field === 'owner'}
          onChange={(e) => setOwnerId(e.target.value)}
          className={`${inputClass} mt-1`}
        >
          <option value="">{strings.tokenPickPlaceholder}</option>
          {eligible.map((u) => (
            <option key={u.id} value={u.id}>
              {u.display_name} ({u.email})
            </option>
          ))}
        </select>
      </div>
      <div className="pt-[1.375rem]">
        <Button type="submit" variant="primary" disabled={issue.isPending}>
          {strings.tokenIssue}
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

function Row({ t, onReveal }: { t: GwTokenSummary; onReveal: (r: Revealed) => void }) {
  const reset = useResetToken()
  const revoke = useRevokeToken()
  const active = t.status === 'active'
  const busy = reset.isPending || revoke.isPending

  function onReset() {
    if (!window.confirm(strings.tokenConfirmReset)) return
    reset.mutate(t.id, {
      onSuccess: (res) => {
        onReveal({ token: res.token, title: strings.tokenDialogReset })
        reset.reset()
      },
    })
  }

  function onRevoke() {
    if (!window.confirm(strings.tokenConfirmRevoke)) return
    revoke.mutate(t.id)
  }

  return (
    <tr className="border-t border-line align-middle">
      <td className="px-3 py-2">
        <div className="font-medium">{t.label}</div>
        <div className="text-xs text-muted">#{t.owner_id}</div>
      </td>
      <td className="px-3 py-2 font-mono text-[0.8125rem]">{`${t.prefix}…`}</td>
      <td className="px-3 py-2 text-sm">
        {active ? strings.tokenStatusActive : strings.tokenStatusRevoked}
      </td>
      <td className="px-3 py-2 text-sm text-muted">{formatDateTime(t.created_at)}</td>
      <td className="px-3 py-2 text-sm text-muted">
        {t.last_used_at !== null
          ? formatRelative(t.last_used_at)
          : active
            ? strings.tokenNeverUsed
            : '—'}
      </td>
      <td className="px-3 py-2">
        {active && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={busy} onClick={onReset}>
              {strings.tokenReset}
            </Button>
            <Button size="sm" variant="danger" disabled={busy} onClick={onRevoke}>
              {strings.tokenRevoke}
            </Button>
            {(reset.isError || revoke.isError) && (
              <span role="alert" className="text-xs text-loss">
                {strings.tokenActionFailed}
              </span>
            )}
          </div>
        )}
      </td>
    </tr>
  )
}

/** Trang quản lý token Gateway (chỉ quản trị viên): cấp, đặt lại, thu hồi, sao chép token. */
export function TokensPanel() {
  const tokens = useTokens()
  const [revealed, setRevealed] = useState<Revealed | null>(null)

  const forbidden = tokens.error instanceof ApiError && tokens.error.status === 403

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{strings.tokensTitle}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">{strings.tokensHint}</p>
      </div>

      {forbidden ? (
        <p role="alert" className="rounded-md bg-notice-bg px-3 py-2 text-sm text-notice-ink">
          {strings.tokensForbidden}
        </p>
      ) : (
        <>
          <Card title={strings.tokenIssueTitle}>
            <IssueForm onIssued={setRevealed} />
          </Card>
          <Card title={strings.tokensTitle}>
            {tokens.isPending && <p className="text-sm text-muted">{strings.tokensLoading}</p>}
            {tokens.isError && (
              <p role="alert" className="text-sm text-loss">
                {strings.tokensError}{' '}
                <Button size="sm" onClick={() => tokens.refetch()}>
                  {strings.retry}
                </Button>
              </p>
            )}
            {tokens.data && tokens.data.tokens.length === 0 && (
              <p className="text-sm text-muted">{strings.tokensEmpty}</p>
            )}
            {tokens.data && tokens.data.tokens.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-muted">
                    <tr>
                      <th className="px-3 py-1.5 font-medium">{strings.tokenColOwner}</th>
                      <th className="px-3 py-1.5 font-medium">{strings.tokenColPrefix}</th>
                      <th className="px-3 py-1.5 font-medium">{strings.tokenColStatus}</th>
                      <th className="px-3 py-1.5 font-medium">{strings.tokenColCreated}</th>
                      <th className="px-3 py-1.5 font-medium">{strings.tokenColLastUsed}</th>
                      <th className="px-3 py-1.5 font-medium">{strings.tokenColActions}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tokens.data.tokens.map((t) => (
                      <Row key={t.id} t={t} onReveal={setRevealed} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {revealed && (
        <TokenSecretDialog
          token={revealed.token}
          title={revealed.title}
          onClose={() => setRevealed(null)}
        />
      )}
    </div>
  )
}
