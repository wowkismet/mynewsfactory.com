/**
 * Session cookies (§5).
 *
 * Three attributes carry the security, and all three are unconditional:
 *
 *   HttpOnly  -- script cannot read the token, so an XSS that gets through
 *                cannot exfiltrate the session.
 *   Secure    -- the token is never sent over cleartext. The site is HTTPS
 *                only (D-009); localhost is a secure context, so this does not
 *                obstruct development.
 *   __Host-   -- the prefix a browser enforces: the cookie must be Secure,
 *                must be Path=/, and must carry no Domain. That last clause is
 *                the point. Without it any subdomain -- including one a future
 *                misconfiguration hands to someone else -- can set a cookie
 *                the apex will accept, and session fixation becomes possible
 *                from outside the application entirely.
 *
 * SameSite differs between the two by design. The access cookie is Lax, so
 * arriving from a link or a search result keeps the reader signed in, which is
 * the whole shape of a news site. The refresh cookie is Strict: it is only
 * ever presented to one endpoint by our own pages, so there is no reason to
 * let any cross-site context send it. Neither is relied on for CSRF defence --
 * `assertSameOrigin` in `csrf.ts` is what does that (§77).
 */

export const ACCESS_COOKIE = '__Host-mnf_at'
export const REFRESH_COOKIE = '__Host-mnf_rt'

export interface CookieSpec {
  name: string
  value: string
  maxAgeSeconds: number
  sameSite: 'Lax' | 'Strict'
}

export function serialiseCookie(spec: CookieSpec): string {
  // Path=/ and the absence of Domain are required by the __Host- prefix. A
  // browser silently ignores a __Host- cookie that omits either, which would
  // fail as "login does not work" rather than as anything diagnosable, so they
  // are written here once and never parameterised.
  return [
    `${spec.name}=${spec.value}`,
    'Path=/',
    `Max-Age=${spec.maxAgeSeconds.toString()}`,
    'HttpOnly',
    'Secure',
    `SameSite=${spec.sameSite}`,
  ].join('; ')
}

/** Expires a cookie. Used on logout and whenever a token is found to be dead. */
export function clearCookie(name: string): string {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`
}

/**
 * Reads one cookie from a Cookie header.
 *
 * Hand-parsed because the header is a flat string and the alternative is a
 * dependency for a split. Returns the first match: a duplicate name is either
 * a client bug or an attempt to shadow the real value, and taking the first is
 * the same rule browsers apply when sending.
 */
export function readCookie(header: string | null, name: string): string | null {
  if (header === null || header === '') return null

  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue

    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim()
    }
  }

  return null
}
