/**
 * POST /api/v1/auth/mfa/verify -- satisfy the factor for this session (§7).
 *
 * Accepts either a code from the app or a recovery code, never both in one
 * request: letting a caller send both would mean one attempt costs two
 * guesses against the lockout counter.
 */

import { ApiProblem } from '@/lib/api/problem'
import { rejectOutcome, requireActor } from '@/lib/api/mfa-shared'
import { optional, string } from '@/lib/api/validate'
import { route } from '@/lib/api/route'
import { useRecoveryCode, verifyCode } from '@/lib/auth/mfa'

export const POST = route({
  method: 'POST',
  auth: 'required',
  allowWithoutMfa: true,
  // The brute-force ceiling that matters is the per-account lockout in
  // `verifyCode`; this only keeps one caller from spending it in a second.
  rateLimit: { bucket: 'mfa.verify', limit: 10, windowSeconds: 300 },
  body: {
    code: optional(string({ max: 16, trim: true })),
    recoveryCode: optional(string({ max: 32, trim: true })),
  },
  handle: async ({ ctx, body, actor }) => {
    const caller = requireActor(actor)
    const { code, recoveryCode } = body

    if ((code === undefined) === (recoveryCode === undefined)) {
      throw new ApiProblem('VALIDATION_ERROR', 'Some fields need attention.', {
        fields: [{ field: 'code', message: 'send either a code or a recovery code' }],
      })
    }

    const outcome =
      code === undefined
        ? await useRecoveryCode(ctx.db, {
            userId: caller.userId,
            sessionId: caller.sessionId,
            code: recoveryCode ?? '',
            ip: ctx.ip,
            requestId: ctx.requestId,
          })
        : await verifyCode(ctx.db, {
            userId: caller.userId,
            sessionId: caller.sessionId,
            code,
            ip: ctx.ip,
            requestId: ctx.requestId,
          })

    if (outcome.status !== 'OK') rejectOutcome(outcome)

    return {
      data: {
        satisfied: true,
        recoveryCodesRemaining: 'remaining' in outcome ? outcome.remaining : undefined,
      },
    }
  },
})
