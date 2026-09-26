/**
 * Validating a post-sign-in destination (§8).
 *
 * A sign-in page that redirects wherever a query string says is an open
 * redirect: an attacker sends `/login?next=https://evil.example/mynewsfactory`,
 * the victim signs in on the real site, and lands on a copy that asks them to
 * "confirm" their password. The link looked legitimate because it was.
 *
 * Lives here rather than on the login page because two pages now need it --
 * sign-in, and the security page a privileged account is sent to on the way.
 * One validator, or the weaker of two becomes the way in.
 */

const DEFAULT_NEXT = '/dashboard'

export function safeNext(raw: string | undefined): string {
  if (raw === undefined || raw === '') return DEFAULT_NEXT

  // Must be a site-relative path. `//evil.example` and `/\evil.example` are
  // both read as authority by at least one browser, so neither counts.
  if (!raw.startsWith('/')) return DEFAULT_NEXT
  if (raw.startsWith('//') || raw.startsWith('/\\')) return DEFAULT_NEXT
  if (raw.includes('://')) return DEFAULT_NEXT

  return raw
}

/** Pulls `next` out of a resolved searchParams object and validates it. */
export function nextFrom(params: Record<string, string | string[] | undefined>): string {
  const raw = params.next
  return safeNext(typeof raw === 'string' ? raw : undefined)
}
