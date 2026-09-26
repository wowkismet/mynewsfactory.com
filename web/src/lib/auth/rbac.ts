/**
 * Authorization decisions (§6).
 *
 * One place answers "may this actor do this", and it answers from live grants.
 * Route protection is not a control: every check that matters runs here, on
 * the server, against rows that revocation updates immediately.
 *
 * The rule that does the work is the scope rule. A grant scoped to a city
 * authorises action *in that city* and nowhere else -- including when the
 * caller supplies no target at all. Omitting the scope is the obvious way to
 * try to escalate, so an unscoped request requires an unscoped grant.
 */

import type { Grant } from '../db/identity'

export interface AuthzTarget {
  countryCode?: string | null
  cityId?: string | null
}

export interface Decision {
  allowed: boolean
  /** Which grant permitted it, for the audit record. */
  via: Grant | null
  reason: string
}

function matches(grant: Grant, target: AuthzTarget | undefined): boolean {
  switch (grant.scope) {
    case 'GLOBAL':
      return true

    case 'COUNTRY':
      // An unscoped request is a request to act everywhere, which a country
      // grant does not authorise.
      return target?.countryCode != null && target.countryCode === grant.countryCode

    case 'CITY':
      return target?.cityId != null && target.cityId === grant.cityId
  }
}

/** The full decision, including which grant allowed it. */
export function decide(
  grants: Grant[],
  permission: string,
  target?: AuthzTarget,
): Decision {
  const candidates = grants.filter((grant) => grant.permission === permission)

  if (candidates.length === 0) {
    return { allowed: false, via: null, reason: `no grant of ${permission}` }
  }

  const permitted = candidates.find((grant) => matches(grant, target))
  if (permitted === undefined) {
    return {
      allowed: false,
      via: null,
      reason: `${permission} is held only outside the requested scope`,
    }
  }

  return { allowed: true, via: permitted, reason: 'granted' }
}

/** The common case: a boolean. */
export function can(grants: Grant[], permission: string, target?: AuthzTarget): boolean {
  return decide(grants, permission, target).allowed
}

/**
 * Whether the actor holds any privileged role, which makes MFA mandatory (§7).
 * Checked against grants rather than a flag on the session, so a role granted
 * mid-session takes effect at once.
 */
export function requiresMfa(grants: Grant[]): boolean {
  return grants.some((grant) => grant.privileged)
}

export class AuthorizationError extends Error {
  readonly permission: string

  constructor(permission: string, reason: string) {
    // The message is for logs. What reaches a client is a generic 403: telling
    // someone which permission they lack maps the authorization model for them.
    super(`Denied ${permission}: ${reason}`)
    this.name = 'AuthorizationError'
    this.permission = permission
  }
}

/** Throws unless the permission is held in the requested scope. */
export function require_(grants: Grant[], permission: string, target?: AuthzTarget): Grant {
  const decision = decide(grants, permission, target)
  if (!decision.allowed || decision.via === null) {
    throw new AuthorizationError(permission, decision.reason)
  }
  return decision.via
}
