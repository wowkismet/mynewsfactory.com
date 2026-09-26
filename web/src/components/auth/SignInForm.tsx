'use client'

/**
 * The sign-in form (§5).
 *
 * Thin on purpose. It collects two values, posts them, and renders whatever
 * the server says. It makes no decision about whether the credentials are
 * good, whether the account is locked, or whether a second factor is needed --
 * those are server answers, and a client that guessed at them would be a
 * second, weaker copy of the rules.
 *
 * Every form here is `method="post"` even though script submits it. Without
 * that, a browser which has not run the handler -- JavaScript blocked, a chunk
 * that failed to load, hydration not finished -- falls back to a native GET and
 * puts each field in the query string: a password, a one-time code or a
 * recovery code in the URL bar, in history, in the referrer, and in every
 * access log between here and the server (§8, §57). POST puts them in a body
 * that goes nowhere instead.
 *
 * `router.refresh()` after success is what makes the header change. The server
 * components re-render with the cookie now set, so the viewer's name appears
 * without a full page load and without the client holding a copy of the
 * session it would have to keep in step.
 */

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { fieldError, post } from './api-client'
import type { FieldProblem } from './api-client'

interface LoginData {
  user: { id: string; displayName: string }
  mfaRequired: boolean
}

export default function SignInForm({ next }: { next: string }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [fields, setFields] = useState<FieldProblem[]>([])

  async function submit(): Promise<void> {
    setBusy(true)
    setMessage(null)
    setFields([])

    const result = await post<LoginData>('/api/v1/auth/login', { email, password })

    if (!result.ok) {
      setMessage(result.message)
      setFields(result.fields)
      setBusy(false)
      return
    }

    if (result.data.mfaRequired) {
      // The password was accepted, but this account holds a privileged role
      // and the session cannot act until a second factor is presented. Sending
      // them on to `next` would land them on a surface that refuses every
      // request, so they go to the page that resolves it, carrying where they
      // were headed so they arrive there afterwards.
      router.replace(`/account/security?next=${encodeURIComponent(next)}`)
      router.refresh()
      return
    }

    router.replace(next)
    router.refresh()
  }

  return (
    <form className="authform" method="post" onSubmit={(e) => {
        // The handler's event type is inferred from JSX; React 19 no longer
        // ships a name for it, and annotating one is how that breaks.
        e.preventDefault()
        void submit()
      }} noValidate>
      {message !== null && (
        <p className="authnote authnote--bad" role="alert">
          {message}
        </p>
      )}

      <label className="field">
        <span className="lbl">Email</span>
        <input
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
          }}
        />
        {fieldError(fields, 'email') !== undefined && (
          <span className="fielderr">{fieldError(fields, 'email')}</span>
        )}
      </label>

      <label className="field">
        <span className="lbl">Password</span>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
          }}
        />
        {fieldError(fields, 'password') !== undefined && (
          <span className="fielderr">{fieldError(fields, 'password')}</span>
        )}
      </label>

      <button className="btn btn--red btn--wide" type="submit" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}
