/**
 * CSRF defence (§5, §77).
 *
 * An origin check, not a token.
 *
 * The reasoning: CSRF exists because a browser attaches cookies to a request
 * the user's page did not intend to make. Every such request carries an
 * `Origin` naming the site that caused it -- browsers have sent it on
 * state-changing requests for years, and it cannot be forged by page script.
 * Comparing it to our own origin therefore refuses the attack at its
 * definition, with no token to mint, store, rotate, or leak into a URL.
 *
 * Two conditions narrow it correctly:
 *
 *   Only mutations. A GET must not change state, so a GET needs no defence
 *   (and adding one would break ordinary navigation).
 *
 *   Only cookie-authenticated requests. A bearer token is attached by client
 *   code, never automatically by the browser, so a cross-site page cannot
 *   cause an authenticated request with one. Requiring an Origin there would
 *   break every non-browser client for no security gain.
 *
 * A missing Origin on a cookie-authenticated mutation is refused rather than
 * allowed. That is the direction that fails safe: the clients that omit it are
 * not browsers, and those clients should be using a bearer token.
 */

import { ApiProblem } from './problem'

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function isMutating(method: string): boolean {
  return MUTATING.has(method.toUpperCase())
}

/**
 * The origin this deployment answers on.
 *
 * Taken from the request's own Host header rather than configuration, because
 * the two disagreeing is exactly the failure that took the site down once
 * already (D-009) -- and here a disagreement would reject every login rather
 * than serve the wrong page. Host is attacker-influenced in general, but that
 * does not matter for this comparison: an attacker who can set Host to their
 * own domain has only made the request fail their own check.
 */
function requestOrigin(request: Request): string | null {
  const forwardedProto = request.headers.get('x-forwarded-proto')
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  if (host === null || host === '') return null

  // nginx terminates TLS and proxies onward as http, so the scheme the client
  // used is only knowable from the forwarded header (deploy/fix-domain.sh).
  const proto = forwardedProto === null || forwardedProto === '' ? 'https' : forwardedProto.split(',')[0]?.trim()

  return `${proto ?? 'https'}://${host}`
}

/** Throws CSRF_REJECTED unless the request demonstrably came from this site. */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin')

  if (origin === null || origin === '') {
    throw new ApiProblem(
      'CSRF_REJECTED',
      'This request must be sent from the site, or authenticated with a bearer token.',
      { internal: 'no Origin header on a cookie-authenticated mutation' },
    )
  }

  const expected = requestOrigin(request)
  if (expected === null || origin !== expected) {
    throw new ApiProblem('CSRF_REJECTED', 'This request did not come from the site.', {
      internal: `origin ${origin} does not match ${expected ?? 'unknown'}`,
    })
  }
}
