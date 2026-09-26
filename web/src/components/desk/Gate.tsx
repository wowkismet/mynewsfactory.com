/**
 * What a refused visitor sees.
 *
 * One component for both refusals, so the two read as deliberate answers
 * rather than as two different things going wrong.
 */

import Link from 'next/link'
import type { GuardOutcome } from '@/lib/auth/guard'

export function Refusal({ outcome, surface }: { outcome: GuardOutcome; surface: string }) {
  if (outcome.state === 'FORBIDDEN') {
    return (
      <div className="shell portal">
        <div className="pagehead">
          <p className="lbl" style={{ color: 'var(--red)' }}>Not permitted</p>
          <h1>{surface}</h1>
          <p>
            Your account does not hold the permission this page needs. If that is wrong, an
            administrator can grant it — permissions are not something this page can change.
          </p>
        </div>
        <p className="empty">
          <Link href="/dashboard">Back to your account</Link>
        </p>
      </div>
    )
  }

  return (
    <div className="shell portal">
      <div className="pagehead">
        <p className="lbl" style={{ color: 'var(--red)' }}>Second factor needed</p>
        <h1>{surface}</h1>
        <p>
          This account holds privileged permissions, so it needs a second factor before it may
          act. Set one up once; after that you confirm a code when you sign in.
        </p>
      </div>
      <p className="empty">
        <Link className="btn btn--red" href="/account/security">Set up two-factor authentication</Link>
      </p>
    </div>
  )
}
