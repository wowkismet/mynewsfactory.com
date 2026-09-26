/**
 * /account/security -- where a second factor is set up and satisfied (§7).
 *
 * Reachable without one, which is the whole point: the account that most needs
 * this page is the account the MFA gate is currently refusing.
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'
import MfaSetup from '@/components/auth/MfaSetup'
import { currentViewer } from '@/lib/auth/session-server'
import { mfaStatus } from '@/lib/auth/mfa'
import { nextFrom } from '@/lib/auth/redirect'
import { db } from '@/lib/db/pool'

export const metadata = { title: 'Security · My News Factory' }
export const dynamic = 'force-dynamic'

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const viewer = await currentViewer()
  if (viewer === null) redirect('/login?next=%2Faccount%2Fsecurity')

  // Where the person was headed when they were routed here. Validated on the
  // server against the same rule the sign-in page uses: a query parameter that
  // decides a redirect is an open redirect unless something checks it.
  const onward = nextFrom(await searchParams)

  // Read directly rather than through the API: this is the same process, and a
  // page fetching its own API is a round trip that can fail on its own.
  let status = {
    enrolled: false,
    confirmed: false,
    recoveryCodesRemaining: 0,
  }
  try {
    status = await mfaStatus(db(), viewer.userId)
  } catch (error) {
    console.error('[security] could not read MFA state', {
      detail: error instanceof Error ? error.message : String(error),
    })
  }

  return (
    <div className="shell authpage">
      <div className="pagehead">
        <p className="lbl">Account</p>
        <h1>Security</h1>
        <p>Signed in as {viewer.email}.</p>
      </div>

      <MfaSetup
        onward={onward}
        initial={{
          ...status,
          required: viewer.mfaRequired,
          satisfied: viewer.mfaSatisfied,
        }}
      />

      <p className="authalt">
        <Link href="/dashboard">Back to your account</Link>
      </p>
    </div>
  )
}
