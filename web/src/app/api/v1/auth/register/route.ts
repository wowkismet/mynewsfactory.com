/**
 * POST /api/v1/auth/register (§5, §6).
 *
 * The response never varies with whether the address was already registered.
 * `register` in `lib/auth/accounts.ts` explains why at length; the short form
 * is that a signup form which distinguishes the two cases is an account
 * enumeration oracle, and §77 requires preventing enumeration.
 *
 * The verification token is not returned. It goes to the address being
 * claimed, which is the only thing that makes it proof of anything. Returning
 * it in the response would let anyone verify any address they can spell.
 */

import { register } from '@/lib/auth/accounts'
import { MIN_PASSWORD_BYTES } from '@/lib/auth/accounts'
import { MAX_PASSWORD_BYTES } from '@/lib/auth/password'
import { route } from '@/lib/api/route'
import { email, string } from '@/lib/api/validate'

const body = {
  email: email(),
  // The upper bound is not cosmetic: Argon2id hashes whatever it is given, so
  // an unbounded password is an unbounded amount of work per request.
  password: string({ min: MIN_PASSWORD_BYTES, max: MAX_PASSWORD_BYTES }),
  displayName: string({ min: 1, max: 120, trim: true }),
}

export const POST = route({
  method: 'POST',
  body,
  // Ten new accounts a minute from one address is already generous for a human
  // and restrictive for a script creating accounts in bulk (§35).
  rateLimit: { bucket: 'auth.register', limit: 10, windowSeconds: 60 },
  handle: async ({ ctx, body: input }) => {
    await register(ctx.db, {
      email: input.email,
      password: input.password,
      displayName: input.displayName,
      ip: ctx.ip,
      requestId: ctx.requestId,
    })

    return {
      status: 202,
      data: {
        message: 'Check your email to finish setting up your account.',
      },
    }
  },
})
