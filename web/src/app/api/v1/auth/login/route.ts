/**
 * POST /api/v1/auth/login (§5).
 *
 * Session fixation is structurally impossible here, which is worth stating
 * because it is usually prevented by remembering to regenerate an id. This
 * endpoint never adopts an identifier from the caller: `issueTokens` mints two
 * fresh 256-bit values from the CSPRNG, and `createSession` inserts a new row.
 * A token the caller already holds -- in a cookie, a header, a query
 * parameter -- has no path into the new session.
 *
 * A caller who is already signed in gets a second, independent session rather
 * than a mutated one, which is also what "sign in on another device" means.
 */

import { signIn } from '@/lib/auth/accounts'
import { createSession, recordAudit, resolveGrants } from '@/lib/db/identity'
import { requiresMfa } from '@/lib/auth/rbac'
import { ApiProblem } from '@/lib/api/problem'
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  serialiseCookie,
} from '@/lib/api/cookies'
import { ACCESS_TTL_SECONDS, REFRESH_TTL_SECONDS, issueTokens } from '@/lib/api/tokens'
import { route } from '@/lib/api/route'
import { MAX_PASSWORD_BYTES } from '@/lib/auth/password'
import { email, string } from '@/lib/api/validate'

const body = {
  email: email(),
  // No minimum. A short password is a wrong password here, and enforcing the
  // registration minimum at sign-in would tell a prober that the stored
  // password is at least that long.
  password: string({ min: 1, max: MAX_PASSWORD_BYTES }),
}

export const POST = route({
  method: 'POST',
  body,
  // Tight, because this is the endpoint worth guessing against. The per-account
  // lockout in the database is the other half of the control (§5).
  rateLimit: { bucket: 'auth.login', limit: 10, windowSeconds: 60 },
  handle: async ({ ctx, body: input }) => {
    const outcome = await signIn(ctx.db, {
      email: input.email,
      password: input.password,
      ip: ctx.ip,
      requestId: ctx.requestId,
    })

    switch (outcome.status) {
      case 'LOCKED':
        throw new ApiProblem(
          'ACCOUNT_LOCKED',
          'Too many failed attempts. Try again in a few minutes.',
          { headers: { 'retry-after': outcome.retryAfterSeconds.toString() } },
        )

      case 'SUSPENDED':
        throw new ApiProblem('FORBIDDEN', 'This account is suspended. Contact support.')

      case 'REJECTED':
        // One message for a wrong password and for no such account. The two
        // must be indistinguishable or the form enumerates addresses (§77).
        throw new ApiProblem('UNAUTHENTICATED', 'Those details do not match an account.')

      case 'OK':
        break
    }

    const grants = await resolveGrants(ctx.db, outcome.userId)
    const mfaRequired = requiresMfa(grants)

    const tokens = issueTokens()
    const sessionId = await createSession(ctx.db, {
      userId: outcome.userId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessExpiresAt: tokens.accessExpiresAt,
      refreshExpiresAt: tokens.refreshExpiresAt,
      ip: ctx.ip,
      userAgent: ctx.request.headers.get('user-agent') ?? '',
      // A privileged account's session is not satisfied by a password alone.
      // The session exists so the second factor can be presented against it,
      // but every other endpoint refuses it until that happens (§7).
      mfaSatisfied: !mfaRequired,
    })

    await recordAudit(ctx.db, {
      actorId: outcome.userId,
      action: 'ACCOUNT_SIGNED_IN',
      resourceType: 'session',
      resourceId: sessionId,
      ip: ctx.ip,
      requestId: ctx.requestId,
    })

    return {
      data: {
        user: { id: outcome.userId, displayName: outcome.displayName },
        mfaRequired,
        expiresIn: ACCESS_TTL_SECONDS,
      },
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
