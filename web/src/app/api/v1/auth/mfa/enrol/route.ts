/**
 * POST /api/v1/auth/mfa/enrol -- issue a secret to enrol against (§7).
 *
 * The secret is returned exactly once, in this response, and never again: it
 * is stored sealed and there is no endpoint that reads it back. Someone who
 * loses it before confirming re-enrols, which replaces it.
 */

import { ApiProblem } from '@/lib/api/problem'
import { beginEnrolment } from '@/lib/auth/mfa'
import { requireActor } from '@/lib/api/mfa-shared'
import { route } from '@/lib/api/route'

export const POST = route({
  method: 'POST',
  auth: 'required',
  allowWithoutMfa: true,
  // Tight: each call throws away any unconfirmed secret and mints another.
  rateLimit: { bucket: 'mfa.enrol', limit: 5, windowSeconds: 300 },
  body: {},
  handle: async ({ ctx, actor }) => {
    const caller = requireActor(actor)

    const { rows } = await ctx.db.query<{ email: string }>(
      'SELECT email FROM users WHERE id = $1',
      [caller.userId],
    )
    const email = rows[0]?.email
    if (email === undefined) throw new ApiProblem('UNAUTHENTICATED', 'Sign in to continue.')

    const result = await beginEnrolment(ctx.db, {
      userId: caller.userId,
      email,
      ip: ctx.ip,
      requestId: ctx.requestId,
    })

    if (result.status === 'ALREADY_CONFIRMED') {
      throw new ApiProblem(
        'CONFLICT',
        'Two-factor authentication is already set up on this account.',
      )
    }

    return { data: result.offer }
  },
})
