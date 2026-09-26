/**
 * POST /api/v1/auth/mfa/confirm -- prove the secret reached the app (§7).
 *
 * Separate from enrolment because a secret nobody can produce a code for is
 * worse than no secret at all: it locks the account out of every privileged
 * action with no way back. Confirmation is the step that proves the app has
 * it, and it is the only moment the recovery codes are shown.
 */

import { rejectOutcome, requireActor } from '@/lib/api/mfa-shared'
import { route } from '@/lib/api/route'
import { string } from '@/lib/api/validate'
import { verifyCode } from '@/lib/auth/mfa'

export const POST = route({
  method: 'POST',
  auth: 'required',
  allowWithoutMfa: true,
  rateLimit: { bucket: 'mfa.confirm', limit: 10, windowSeconds: 300 },
  body: { code: string({ max: 16, trim: true }) },
  handle: async ({ ctx, body, actor }) => {
    const caller = requireActor(actor)

    const outcome = await verifyCode(ctx.db, {
      userId: caller.userId,
      sessionId: caller.sessionId,
      code: body.code,
      issueRecoveryCodes: true,
      ip: ctx.ip,
      requestId: ctx.requestId,
    })

    if (outcome.status !== 'OK') rejectOutcome(outcome)

    return { data: { confirmed: true, recoveryCodes: outcome.recoveryCodes ?? [] } }
  },
})
