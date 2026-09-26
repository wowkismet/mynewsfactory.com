/**
 * GET /api/v1/auth/mfa -- where this account and this session stand (§7).
 *
 * `required` and `satisfied` are the two the interface acts on: together they
 * say whether the person is about to be refused, and the account surface uses
 * them to prompt before they hit a wall rather than after.
 */

import { mfaStatus } from '@/lib/auth/mfa'
import { requireActor } from '@/lib/api/mfa-shared'
import { route } from '@/lib/api/route'

export const GET = route({
  method: 'GET',
  auth: 'required',
  allowWithoutMfa: true,
  rateLimit: { bucket: 'mfa.status', limit: 60, windowSeconds: 60 },
  handle: async ({ ctx, actor }) => {
    const caller = requireActor(actor)
    const status = await mfaStatus(ctx.db, caller.userId)

    return {
      data: {
        ...status,
        required: caller.mfaRequired,
        satisfied: caller.mfaSatisfied,
      },
    }
  },
})
