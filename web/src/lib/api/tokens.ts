/**
 * Session token issuance (§5).
 *
 * One place decides what a session is worth in minutes, so the access and
 * refresh lifetimes cannot drift apart between login and refresh.
 *
 * The asymmetry is the point. The access token is short, because it is
 * presented on every request and is the thing most likely to be captured; the
 * refresh token is long but single-use, and reusing a consumed one revokes the
 * whole session (D-013). A stolen access token therefore expires on its own,
 * and a stolen refresh token announces itself the moment either party uses it.
 */

import { generateToken } from '../auth/hashing'

/** Fifteen minutes. Long enough to avoid a refresh on every page, short enough to expire a theft. */
export const ACCESS_TTL_SECONDS = 15 * 60

/** Thirty days. The period after which a dormant reader signs in again. */
export const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60

export interface IssuedTokens {
  accessToken: string
  refreshToken: string
  accessExpiresAt: Date
  refreshExpiresAt: Date
}

export function issueTokens(now: Date = new Date()): IssuedTokens {
  return {
    // 256 bits from the CSPRNG, stored only as a SHA-256 digest (D-015). The
    // value below is the only time the token exists in plaintext on the
    // server, and it leaves in a Set-Cookie header without being logged.
    accessToken: generateToken(),
    refreshToken: generateToken(),
    accessExpiresAt: new Date(now.getTime() + ACCESS_TTL_SECONDS * 1000),
    refreshExpiresAt: new Date(now.getTime() + REFRESH_TTL_SECONDS * 1000),
  }
}
