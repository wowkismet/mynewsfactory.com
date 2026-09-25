/**
 * POST /api/v1/auth/refresh (§5).
 *
 * Rotation with reuse detection (D-013). `rotateRefreshToken` does the work in
 * one transaction; this route's job is to decide what each outcome means to a
 * client and to clear the cookies when the session is gone.
 *
 * REUSE_DETECTED is the interesting one. A consumed refresh token presented
 * again means it leaked -- or that a client replayed it, which is
 * indistinguishable from the outside. The session is revoked either way,
 * because refusing only the token would leave a live session an attacker may
 * also hold. The legitimate user signs in again; the attacker gets nothing.
 */

import { ApiProblem } from '@/lib/api/problem'
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  readCookie,
  serialiseCookie,
} from '@/lib/api/cookies'
import { ACCESS_TTL_SECONDS, REFRESH_TTL_SECONDS, issueTokens } from '@/lib/api/tokens'
import { recordAudit, rotateRefreshToken } from '@/lib/db/identity'
import { route } from '@/lib/api/route'
import { hashToken } from '@/lib/auth/hashing'

export const POST = route({
  method: 'POST',
  rateLimit: { bucket: 'auth.refresh', limit: 60, windowSeconds: 60 },
  handle: async ({ ctx }) => {
    // The refresh token is only ever read from its cookie. Accepting it in a
    // body or a query string would put a long-lived credential somewhere it
    // gets logged by a proxy.
    const presented = readCookie(ctx.request.headers.get('cookie'), REFRESH_COOKIE)

    if (presented === null) {
      throw new ApiProblem('UNAUTHENTICATED', 'Sign in to continue.')
    }

    const tokens = issueTokens()
    const outcome = await rotateRefreshToken(ctx.db, presented, {
      refreshToken: tokens.refreshToken,
      refreshExpiresAt: tokens.refreshExpiresAt,
    })

    switch (outcome.status) {
      case 'INVALID':
        throw new ApiProblem('UNAUTHENTICATED', 'Your session has ended. Sign in again.', {
          headers: {},
        })

      case 'REUSE_DETECTED':
        await recordAudit(ctx.db, {
          actorId: outcome.userId,
          action: 'SESSION_REFRESH_REUSE_DETECTED',
          resourceType: 'session',
          resourceId: outcome.sessionId,
          ip: ctx.ip,
          requestId: ctx.requestId,
          // The digest, never the token. Enough to correlate two sightings of
          // the same leaked credential without storing a usable copy of it.
          after: { presentedDigest: hashToken(presented).slice(0, 16) },
        })

        throw new ApiProblem(
          'UNAUTHENTICATED',
          'Your session has ended for security reasons. Sign in again.',
        )

      case 'ROTATED':
        break
    }

    // The access token is replaced too. Rotating only the refresh token would
    // leave a captured access token live for its full remaining lifetime.
    await ctx.db.query('UPDATE sessions SET token_hash = $2, expires_at = $3 WHERE id = $1', [
      outcome.sessionId,
      hashToken(tokens.accessToken),
      tokens.accessExpiresAt,
    ])

    return {
      data: { expiresIn: ACCESS_TTL_SECONDS },
      cookies: [
        serialiseCookie({
          name: ACCESS_COOKIE,
          value: tokens.accessToken,
          maxAgeSeconds: ACCESS_TTL_SECONDS,
          sameSite: 'Lax',
        }),
        serialiseCookie({
          name: REFRESH_COOKIE,
          value: tokens.refreshToken,
          maxAgeSeconds: REFRESH_TTL_SECONDS,
          sameSite: 'Strict',
        }),
      ],
    }
  },
})
