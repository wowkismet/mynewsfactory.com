/**
 * POST /api/v1/auth/logout (§5).
 *
 * Revokes the session server-side and clears both cookies. Clearing cookies
 * alone would be theatre: the tokens would remain valid for anyone who had
 * already captured them, and "sign out" on a shared machine would protect
 * nobody. The revocation is the logout; the cookies are housekeeping.
 *
 * `all: true` ends every session for the account, which is what a user reaches
 * for after losing a device.
 */

import { recordAudit, revokeAllSessions, revokeSession } from '@/lib/db/identity'
import { ACCESS_COOKIE, REFRESH_COOKIE, clearCookie } from '@/lib/api/cookies'
import { route } from '@/lib/api/route'
import { boolean, optional } from '@/lib/api/validate'

const body = { all: optional(boolean()) }

export const POST = route({
  method: 'POST',
  auth: 'required',
  body,
  handle: async ({ ctx, body: input, actor }) => {
    // `auth: 'required'` guarantees this, but the type does not know that.
    if (actor === null) throw new Error('unreachable: logout without an actor')

    const everywhere = input.all === true

    if (everywhere) {
      await revokeAllSessions(ctx.db, actor.userId, 'signed out of all devices')
    } else {
      await revokeSession(ctx.db, actor.sessionId, 'signed out')
    }

    await recordAudit(ctx.db, {
      actorId: actor.userId,
      action: everywhere ? 'ACCOUNT_SIGNED_OUT_ALL' : 'ACCOUNT_SIGNED_OUT',
      resourceType: 'session',
      resourceId: actor.sessionId,
      ip: ctx.ip,
      requestId: ctx.requestId,
    })

    return {
      data: { signedOut: true },
      cookies: [clearCookie(ACCESS_COOKIE), clearCookie(REFRESH_COOKIE)],
    }
  },
})
