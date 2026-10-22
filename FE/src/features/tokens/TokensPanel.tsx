import type { GwTokenSummary } from '@az-sentinel/shared'
import { type FormEvent, useState } from 'react'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { inputClass } from '../../components/styles'
import { ApiError } from '../../lib/api-client'
import { formatDateTime, formatRelative } from '../../lib/format'
import { strings } from '../../lib/strings'
import { useIssueToken, useResetToken, useRevokeToken, useTokens } from './api'
import { TokenSecretDialog } from './TokenSecretDialog'

type Revealed = { token: string; title: string }

function IssueForm({ onIssued }: { onIssued: (r: Revealed) => void }) {
  const issue = useIssueToken()
  const [ownerId, setOwnerId] = useState('')
  const [label, setLabel] = useState('')
  const [error, setError] = useState<{ field: 'owner' | 'label' | 'server'; text: string } | null>(
    null,
  )

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const id = Number(ownerId.trim())
    if (ownerId.trim() === '' || !Number.isInteger(id) || id <= 0) {
      setError({ field: 'owner', text: strings.tokenOwnerInvalid })
      return
    }
    if (label.trim() === '') {
      setError({ field: 'label', text: strings.tokenLabelRequired })
      return
    }
    setError(null)
    issue.mutate(
      { owner_id: id, label: label.trim() },
      {
        onSuccess: (res) => {
          onIssued({ token: res.token, title: strings.tokenDialogIssue })
          issue.reset()
          setOwnerId('')
          setLabel('')
        },
        onError: (err) =>
          setError({
            field: 'server',
            text:
              err instanceof ApiError && err.status === 409
                ? strings.tokenIssueConflict
                : strings.tokenIssueFailed,
          }),
      },
    )
  }

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-wrap items-start gap-3">
      <div className="w-40">
        <label className="block text-sm font-medium" htmlFor="gw-owner-id">
          {strings.tokenOwnerId}
        </label>
        <input
          id="gw-owner-id"
          inputMode="numeric"
          autoComplete="off"
          value={ownerId}
          aria-invalid={error?.field === 'owner'}
          onChange={(e) => setOwnerId(e.target.value)}
          className={`${inputClass} mt-1`}
        />
      </div>
      <div className="min-w-56 flex-1">
        <label className="block text-sm font-medium" htmlFor="gw-label">
          {strings.tokenLabel}
        </label>
        <input
          id="gw-label"
          autoComplete="off"
          maxLength={64}
          value={label}
          aria-invalid={error?.field === 'label'}
          onChange={(e) => setLabel(e.target.value)}
          className={`${inputClass} mt-1`}
        />
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
