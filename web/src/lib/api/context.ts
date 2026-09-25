/**
 * Who is calling, and from where (§5, §6, §77).
 *
 * Resolution happens once per request and the result is what every handler
 * reads. The alternative -- each route deciding for itself -- is how one route
 * ends up trusting a header the others validate.
 */

import type { Db } from '../db/client'
import type { Grant } from '../db/identity'
import { findSessionByAccessToken, resolveGrants } from '../db/identity'
import { requiresMfa } from '../auth/rbac'
import { ACCESS_COOKIE, readCookie } from './cookies'

export interface Actor {
  userId: string
  sessionId: string
  /** Live grants, read this request. A role revoked a second ago is already gone. */
  grants: Grant[]
  /** Whether this session has cleared a second factor. */
  mfaSatisfied: boolean
  /** Whether any held grant is privileged, making MFA mandatory (§7). */
  mfaRequired: boolean
}

export interface RequestContext {
  db: Db
  request: Request
  requestId: string
  /** Null when the caller is anonymous. */
  actor: Actor | null
  /** Client address, or null when it cannot be determined. */
  ip: string | null
  /** True when the session came from a cookie, which is what CSRF applies to. */
  cookieAuthenticated: boolean
}

/**
 * A correlation id for this request.
 *
 * Honours an inbound `x-request-id` so a trace survives the proxy hop, but
 * sanitises it: the value is echoed to the client in the error envelope and
 * written to logs, so an unfiltered header is both a log-injection vector and
 * a way to plant text in someone else's error report.
 */
export function resolveRequestId(request: Request): string {
  const supplied = request.headers.get('x-request-id')

  if (supplied !== null && /^[A-Za-z0-9_-]{8,64}$/.test(supplied)) return supplied

  return crypto.randomUUID()
}

/**
 * The client address.
 *
 * `x-forwarded-for` is only meaningful because nginx sits in front and sets
 * it; the first entry is the original client. It is attacker-controllable in
 * principle, which is why it is never used for authorization -- only for rate
 * limiting and, as a keyed hash, for audit records (D-015).
 */
export function resolveIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded !== null && forwarded !== '') {
    const first = forwarded.split(',')[0]?.trim()
    if (first !== undefined && first !== '') return first
  }

  const real = request.headers.get('x-real-ip')
  if (real !== null && real !== '') return real

  return null
}

interface PresentedToken {
  token: string
  fromCookie: boolean
}

/**
 * Finds the access token.
 *
 * A bearer header wins over a cookie. A client that sets the header is making
 * an explicit choice; honouring the cookie instead would let an ambient
 * session silently override an intended identity.
 */
function presentedToken(request: Request): PresentedToken | null {
  const authorization = request.headers.get('authorization')

  if (authorization?.toLowerCase().startsWith('bearer ') === true) {
    const token = authorization.slice('bearer '.length).trim()
    if (token !== '') return { token, fromCookie: false }
  }

  const cookie = readCookie(request.headers.get('cookie'), ACCESS_COOKIE)
  if (cookie !== null && cookie !== '') return { token: cookie, fromCookie: true }

  return null
}

export interface ResolvedActor {
  actor: Actor | null
  cookieAuthenticated: boolean
}

/**
 * Resolves the caller from the presented token.
 *
 * An unknown, expired or revoked token yields an anonymous caller rather than
 * an error. Distinguishing "no token" from "bad token" here would let an
 * unauthenticated prober test tokens against this endpoint; the routes that
 * require authentication produce the 401, uniformly, from one place.
 */
export async function resolveActor(db: Db, request: Request): Promise<ResolvedActor> {
  const presented = presentedToken(request)
  if (presented === null) return { actor: null, cookieAuthenticated: false }

  const session = await findSessionByAccessToken(db, presented.token)
  if (session === null) return { actor: null, cookieAuthenticated: presented.fromCookie }

  const grants = await resolveGrants(db, session.userId)

  return {
    cookieAuthenticated: presented.fromCookie,
    actor: {
      userId: session.userId,
      sessionId: session.id,
      grants,
      mfaSatisfied: session.mfaSatisfied,
      mfaRequired: requiresMfa(grants),
    },
  }
}
