'use client'

/**
 * Sign out (§5).
 *
 * A button, not a link. Signing out changes state, and a GET that changes
 * state is both wrong and pre-fetchable -- a browser or a crawler following
 * links would sign people out for them.
 *
 * The POST it sends is cookie-authenticated, so the API requires a same-origin
 * `Origin` header (D-016). The browser attaches one to a same-origin fetch
 * automatically, which is exactly the property the check relies on.
 */

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { post } from './api-client'

export default function SignOutButton({ className }: { className?: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function signOut(): Promise<void> {
    setBusy(true)
    await post('/api/v1/auth/logout', {})
    // Refresh regardless of the outcome. If the call failed the session may
    // still be live, and re-rendering shows the truth rather than a hopeful
    // signed-out header.
    router.replace('/')
    router.refresh()
  }

  return (
    <button
      type="button"
      className={className ?? 'linkbtn'}
      onClick={() => void signOut()}
      disabled={busy}
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  )
}
