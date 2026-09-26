/**
 * POST /api/v1/news/[slug]/review -- move a story through the desk (§12).
 *
 * The review statuses only. PUBLISHED and UNPUBLISHED are deliberately not
 * accepted here: they have their own permissions, and allowing them through a
 * `news.review` endpoint would let a sub-editor publish by naming a status —
 * an authorization bypass dressed as a parameter (§77).
 */

import type { NewsStatus } from '@/lib/db/newsroom'
import { ApiProblem } from '@/lib/api/problem'
import { applyTransition } from '@/lib/api/editorial'
import { route } from '@/lib/api/route'
import { optional, string } from '@/lib/api/validate'

const PERMISSION = 'news.review'

/** The statuses this endpoint may set. Publication is not one of them. */
const REVIEW_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'AI_REVIEW',
  'EDITOR_REVIEW',
  'FACT_CHECK',
  'APPROVED',
  'CORRECTION_REQUIRED',
  'REJECTED',
] as const

function assertReviewStatus(value: string): NewsStatus {
  const allowed: readonly string[] = REVIEW_STATUSES
  if (!allowed.includes(value)) {
    throw new ApiProblem('VALIDATION_ERROR', 'Some fields need attention.', {
      fields: [{ field: 'to', message: `must be one of ${REVIEW_STATUSES.join(', ')}` }],
    })
  }
  return value as NewsStatus
}

export const POST = route({
  method: 'POST',
  auth: 'required',
  permission: { key: PERMISSION },
  rateLimit: { bucket: 'news.review', limit: 60, windowSeconds: 60 },
  body: {
    to: string({ max: 32, trim: true }),
    note: optional(string({ max: 500, trim: true })),
  },
  handle: async (input) =>
    applyTransition({ input, to: assertReviewStatus(input.body.to), permission: PERMISSION }),
})
