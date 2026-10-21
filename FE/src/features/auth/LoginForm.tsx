import { loginRequestSchema } from '@az-sentinel/shared'
import { type FormEvent, useState } from 'react'
import { Button } from '../../components/Button'
import { Icon } from '../../components/Icon'
import { inputClass } from '../../components/styles'
import { ApiError } from '../../lib/api-client'
import { strings } from '../../lib/strings'
import { useLogin } from './api'

type FieldErrors = { email?: string; password?: string }

function serverMessage(error: unknown): string {
  // 401/403/429: BE trả thông điệp tiếng Việt đã được soạn sẵn cho người dùng.
  if (error instanceof ApiError && [401, 403, 429].includes(error.status)) return error.message
  return strings.loginFailed
}

export function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const login = useLogin()

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const parsed = loginRequestSchema.safeParse({ email: email.trim(), password })
    if (!parsed.success) {
      const next: FieldErrors = {}
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === 'email') next.email = strings.emailInvalid
        if (issue.path[0] === 'password') next.password = strings.passwordRequired
      }
      setErrors(next)
      return
    }
    setErrors({})
    login.mutate(parsed.data)
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mt-4 space-y-4">
      <div>
        <label htmlFor="email" className="block text-sm font-medium">
          {strings.email}
        </label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={errors.email ? true : undefined}
          className={`mt-1 ${inputClass} h-10`}
        />
        {errors.email && <p className="mt-1 text-sm text-loss">{errors.email}</p>}
      </div>
      <div>
        <label htmlFor="password" className="block text-sm font-medium">
          {strings.password}
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={errors.password ? true : undefined}
          className={`mt-1 ${inputClass} h-10`}
        />
        {errors.password && <p className="mt-1 text-sm text-loss">{errors.password}</p>}
      </div>
      {login.isError && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md bg-loss-bg px-3 py-2 text-sm text-loss"
        >
          <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
          {serverMessage(login.error)}
        </p>
      )}
      <Button type="submit" variant="primary" className="h-10 w-full" disabled={login.isPending}>
        {login.isPending ? strings.loginSubmitting : strings.loginSubmit}
      </Button>
    </form>
  )
}
