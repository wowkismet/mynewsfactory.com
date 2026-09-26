'use client'

/**
 * The registration form (§6).
 *
 * The success copy is worded to be true whether or not the address was already
 * registered, because the server gives the same answer either way (D-018). A
 * form that said "account created!" would quietly undo that: a prober would
 * learn nothing from the API and everything from the sentence next to it.
 */

import Link from 'next/link'
import { useState } from 'react'
import { fieldError, post } from './api-client'
import type { FieldProblem } from './api-client'

const MIN_PASSWORD = 12

export default function RegisterForm() {
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [fields, setFields] = useState<FieldProblem[]>([])

  async function submit(): Promise<void> {
    setBusy(true)
    setMessage(null)
    setFields([])

    const result = await post<{ message: string }>('/api/v1/auth/register', {
      email,
      password,
      displayName,
    })

    if (!result.ok) {
      setMessage(result.message)
      setFields(result.fields)
      setBusy(false)
      return
    }

    setDone(true)
    setBusy(false)
  }

  if (done) {
    return (
      <div className="authnote authnote--ok" role="status">
        <p>
          <strong>Check your email.</strong> If that address can be registered, we have sent a
          link to finish setting up the account.
        </p>
        <p className="meta">
          Email delivery is not switched on yet, so no message will arrive today. The account and
          its verification token are created correctly — this is the one step still to build.
        </p>
        <p>
          <Link href="/login">Back to sign in</Link>
        </p>
      </div>
    )
  }

  return (
    <form className="authform" onSubmit={(e) => {
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
        <span className="lbl">Your name</span>
        <input
          type="text"
          name="displayName"
          autoComplete="name"
          required
          value={displayName}
          onChange={(e) => {
            setDisplayName(e.target.value)
          }}
        />
        {fieldError(fields, 'displayName') !== undefined && (
          <span className="fielderr">{fieldError(fields, 'displayName')}</span>
        )}
      </label>

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
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
          }}
        />
        <span className="meta">At least {MIN_PASSWORD} characters.</span>
        {fieldError(fields, 'password') !== undefined && (
          <span className="fielderr">{fieldError(fields, 'password')}</span>
        )}
      </label>

      <button className="btn btn--red btn--wide" type="submit" disabled={busy}>
        {busy ? 'Creating account…' : 'Create account'}
      </button>
    </form>
  )
}
