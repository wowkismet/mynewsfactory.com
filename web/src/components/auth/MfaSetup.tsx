'use client'

/**
 * Enrolling and satisfying the second factor (§7).
 *
 * Three states, and the middle one is the one that matters: once a secret has
 * been issued but not confirmed, the account has a credential nobody can
 * produce a code for. So the secret stays on screen until a code is accepted,
 * and the page says plainly that it will not be shown again.
 *
 * The recovery codes appear exactly once, in the confirmation response. There
 * is no endpoint that re-reads them -- they are stored as digests -- so the
 * screen says so rather than implying they can be fetched later.
 */

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { post } from './api-client'

interface Offer {
  secret: string
  otpauthUri: string
}

interface Status {
  enrolled: boolean
  confirmed: boolean
  required: boolean
  satisfied: boolean
  recoveryCodesRemaining: number
}

export default function MfaSetup({
  initial,
  onward,
}: {
  initial: Status
  /** Where the person was going before the second factor stopped them. */
  onward: string
}) {
  const router = useRouter()

  const [offer, setOffer] = useState<Offer | null>(null)
  const [code, setCode] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [codes, setCodes] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function begin(): Promise<void> {
    setBusy(true)
    setError(null)
    const result = await post<Offer>('/api/v1/auth/mfa/enrol', {})
    setBusy(false)
    if (!result.ok) { setError(result.message); return }
    setOffer(result.data)
  }

  async function confirm(): Promise<void> {
    setBusy(true)
    setError(null)
    const result = await post<{ recoveryCodes: string[] }>('/api/v1/auth/mfa/confirm', { code })
    setBusy(false)
    if (!result.ok) { setError(result.message); return }
    setCodes(result.data.recoveryCodes)
    setOffer(null)
    setCode('')
    router.refresh()
  }

  async function verify(): Promise<void> {
    setBusy(true)
    setError(null)
    const result = await post('/api/v1/auth/mfa/verify', { code })
    setBusy(false)
    if (!result.ok) { setError(result.message); return }
    setCode('')
    router.replace(onward)
    router.refresh()
  }

  async function recover(): Promise<void> {
    setBusy(true)
    setError(null)
    const result = await post('/api/v1/auth/mfa/verify', { recoveryCode })
    setBusy(false)
    if (!result.ok) { setError(result.message); return }
    setRecoveryCode('')
    router.replace(onward)
    router.refresh()
  }

  if (codes !== null) {
    return (
      <section className="authcard">
        <h2 className="rule-head">Save these recovery codes</h2>
        <p className="authnote authnote--ok">
          Two-factor authentication is on, and this session is confirmed.
        </p>
        <p className="meta">
          Each code works once. They are stored only as digests, so this is the one time they can
          be shown — there is no way to read them back. Keep them somewhere other than the phone
          holding your authenticator app.
        </p>
        <ul className="chips" style={{ fontFamily: 'var(--mono)' }}>
          {codes.map((entry) => <li className="chip" key={entry}>{entry}</li>)}
        </ul>
        <p>
          <button
            type="button"
            className="btn btn--red"
            onClick={() => { router.replace(onward); router.refresh() }}
          >
            I have saved them — continue
          </button>
        </p>
      </section>
    )
  }

  // Enrolled and confirmed, but this session has not presented a code.
  if (initial.confirmed && !initial.satisfied) {
    return (
      <section className="authcard">
        <h2 className="rule-head">Confirm this session</h2>
        <p className="meta">
          Two-factor authentication is set up on this account. Each session confirms separately, so
          a device that signs in later cannot act on a code you typed here.
        </p>
        {error !== null && <p className="authnote authnote--bad">{error}</p>}
        <form className="authform" method="post" onSubmit={(e) => { e.preventDefault(); void verify() }}>
          <div className="field">
            <label htmlFor="mfa-code">Code from your app</label>
            <input
              id="mfa-code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => { setCode(e.target.value) }}
            />
          </div>
          <button className="btn btn--red btn--wide" type="submit" disabled={busy || code === ''}>
            {busy ? 'Checking…' : 'Confirm'}
          </button>
        </form>

        <details>
          <summary className="lbl">Lost the device?</summary>
          <p className="meta">
            Spend a recovery code. {initial.recoveryCodesRemaining} left — each works once, and
            using one is recorded.
          </p>
          <form className="authform" method="post" onSubmit={(e) => { e.preventDefault(); void recover() }}>
            <div className="field">
              <label htmlFor="mfa-recovery">Recovery code</label>
              <input
                id="mfa-recovery"
                name="recoveryCode"
                autoComplete="off"
                value={recoveryCode}
                onChange={(e) => { setRecoveryCode(e.target.value) }}
              />
            </div>
            <button className="btn btn--wide" type="submit" disabled={busy || recoveryCode === ''}>
              {busy ? 'Checking…' : 'Use recovery code'}
            </button>
          </form>
        </details>
      </section>
    )
  }

  if (initial.confirmed) {
    return (
      <section className="authcard">
        <h2 className="rule-head">Two-factor authentication</h2>
        <p className="authnote authnote--ok">On, and satisfied for this session.</p>
        <p className="meta">
          {initial.recoveryCodesRemaining} recovery codes left. Replacing the authenticator app
          means re-enrolling, which an administrator has to clear first — a live session being able
          to silently re-point the second factor would defeat it.
        </p>
      </section>
    )
  }

  if (offer !== null) {
    return (
      <section className="authcard">
        <h2 className="rule-head">Add it to your app</h2>
        <p className="meta">
          Scan or paste this into an authenticator app, then type the six-digit code it shows. The
          secret is not stored anywhere you can read it back, so finish now rather than returning
          later.
        </p>
        <dl className="factlist">
          <dt>Secret</dt>
          <dd style={{ fontFamily: 'var(--mono)', wordBreak: 'break-all' }}>{offer.secret}</dd>
          <dt>Setup link</dt>
          <dd style={{ wordBreak: 'break-all' }}>{offer.otpauthUri}</dd>
        </dl>
        {error !== null && <p className="authnote authnote--bad">{error}</p>}
        <form className="authform" method="post" onSubmit={(e) => { e.preventDefault(); void confirm() }}>
          <div className="field">
            <label htmlFor="mfa-confirm">Code from your app</label>
            <input
              id="mfa-confirm"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => { setCode(e.target.value) }}
            />
          </div>
          <button className="btn btn--red btn--wide" type="submit" disabled={busy || code === ''}>
            {busy ? 'Confirming…' : 'Confirm and finish'}
          </button>
        </form>
      </section>
    )
  }

  return (
    <section className="authcard">
      <h2 className="rule-head">Two-factor authentication</h2>
      <p className="meta">
        {initial.required
          ? 'This account holds privileged permissions, so it cannot act until a second factor is set up.'
          : 'Not required for this account, but it is the single biggest thing you can do to protect it.'}
      </p>
      {error !== null && <p className="authnote authnote--bad">{error}</p>}
      <button className="btn btn--red btn--wide" type="button" disabled={busy} onClick={() => void begin()}>
        {busy ? 'Starting…' : 'Set up an authenticator app'}
      </button>
    </section>
  )
}
