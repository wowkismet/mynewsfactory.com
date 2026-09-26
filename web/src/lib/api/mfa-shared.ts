/**
 * What the three MFA endpoints have in common.
 *
 * Mapping an outcome to a response is the part that must not drift between
 * them: a lockout that reports 401 on one route and 429 on another tells an
 * attacker which route to use.
 */

import type { Actor } from './context'
import type { VerifyOutcome } from '../auth/mfa'
import { ApiProblem } from './problem'

/** Narrows the actor the pipeline has already guaranteed for `auth: 'required'`. */
export function requireActor(actor: Actor | null): Actor {
  if (actor === null) throw new ApiProblem('UNAUTHENTICATED', 'Sign in to continue.')
  return actor
}

/** Turns every non-success outcome into the response it always gets. */
export function rejectOutcome(outcome: VerifyOutcome): never {
  switch (outcome.status) {
    case 'NOT_ENROLLED':
      throw new ApiProblem('CONFLICT', 'Set up two-factor authentication first.')

    case 'LOCKED': {
      const seconds = Math.max(1, Math.ceil((outcome.until.getTime() - Date.now()) / 1000))
      throw new ApiProblem('RATE_LIMITED', 'Too many attempts. Try again shortly.', {
        headers: { 'retry-after': seconds.toString() },
      })
    }

    case 'REJECTED':
      // Deliberately the same message for a wrong code and a wrong recovery
      // code: which one was wrong is not something a caller needs told.
      throw new ApiProblem('UNAUTHENTICATED', 'That code was not accepted.')

    case 'OK':
      throw new Error('rejectOutcome called on a successful outcome')
  }
}
