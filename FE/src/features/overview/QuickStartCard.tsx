import { useState } from 'react'
import { Link } from 'wouter'
import { Card } from '../../components/Card'
import { Icon } from '../../components/Icon'
import { strings } from '../../lib/strings'
import { useMe } from '../auth/api'
import { useLinks } from '../links/api'
import { useServerInfo } from '../server/api'
import { useTokens } from '../tokens/api'
import { useUsers } from '../users/api'

type Step = { title: string; hint: string; done: boolean; href?: string; go?: string }

/**
 * Danh sách "Bắt đầu nhanh" cho quản trị viên: 4 bước từ lúc cài xong tới lúc có số liệu. Mỗi bước tự đánh
 * dấu xong theo dữ liệu thật (có người dùng, có token, Gateway đang nối, có tài khoản MT5) nên không ai phải
 * nhớ mình làm tới đâu. Hết việc thì gọn lại thành một dòng; có thể ẩn.
 */
export function QuickStartCard() {
  const me = useMe()
  const isAdmin = me.data?.role === 'admin' || me.data?.role === 'root_admin'
  const users = useUsers()
  const tokens = useTokens()
  const links = useLinks()
  const server = useServerInfo()
  const [hidden, setHidden] = useState(false)

  if (!isAdmin || hidden) return null
  if (users.isPending || tokens.isPending || links.isPending) return null

  const others = (users.data?.users ?? []).filter((u) => u.id !== me.data?.id)
  const steps: Step[] = [
    {
      title: strings.quickStepUser,
      hint: strings.quickStepUserHint,
      done: others.length > 0,
      href: '/users',
      go: strings.quickStepUserGo,
    },
    {
      title: strings.quickStepToken,
      hint: strings.quickStepTokenHint,
      done: (tokens.data?.tokens ?? []).length > 0,
      href: '/tokens',
      go: strings.quickStepTokenGo,
    },
    {
      title: strings.quickStepGateway,
      hint: strings.quickStepGatewayHint,
      done: (server.data?.gateways ?? 0) > 0,
    },
    {
      title: strings.quickStepAccount,
      hint: strings.quickStepAccountHint,
      done: (links.data?.links ?? []).length > 0,
      href: '/links',
      go: strings.quickStepAccountGo,
    },
  ]
  const allDone = steps.every((s) => s.done)
  const next = steps.findIndex((s) => !s.done)

  return (
    <Card
      title={strings.quickTitle}
      action={
        <button
          type="button"
          className="text-xs text-muted underline underline-offset-2 hover:text-ink"
          onClick={() => setHidden(true)}
        >
          {strings.quickHide}
        </button>
      }
    >
      {allDone ? (
        <p className="text-sm text-gain">{strings.quickAllDone}</p>
      ) : (
        <>
          <p className="text-sm text-muted">{strings.quickIntro}</p>
          <ol className="mt-3 space-y-2.5">
            {steps.map((s, i) => (
              <li key={s.title} className="flex gap-3 text-sm">
                <span
                  aria-hidden="true"
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    s.done
                      ? 'bg-gain-bg text-gain'
                      : i === next
                        ? 'bg-accent text-accent-ink'
                        : 'bg-raised text-muted'
                  }`}
                >
                  {s.done ? <Icon name="check" size={12} /> : i + 1}
                </span>
                <div className="min-w-0">
                  <p className="font-medium">
                    {s.title}
                    {s.done && (
                      <span className="ml-2 text-xs font-normal text-gain">
                        {strings.quickDone}
                      </span>
                    )}
                  </p>
                  {!s.done && <p className="text-muted">{s.hint}</p>}
                  {!s.done && i === next && s.href && (
                    <Link
                      href={s.href}
                      className="mt-1.5 inline-flex h-8 items-center rounded-md bg-accent px-3 text-xs font-semibold text-accent-ink"
                    >
                      {s.go}
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </Card>
  )
}
