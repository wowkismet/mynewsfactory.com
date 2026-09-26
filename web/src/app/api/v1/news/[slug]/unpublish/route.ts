/**
 * POST /api/v1/news/[slug]/unpublish -- withdraw a published story (§12, §43).
 *
 * Separate from publish and behind its own permission, because taking a story
 * down is the more dangerous of the two: it removes something readers may have
 * already acted on. The version row written here is what lets a correction
 * later say what the story said before it was pulled.
 */

import { applyTransition } from '@/lib/api/editorial'
import { route } from '@/lib/api/route'
import { optional, string } from '@/lib/api/validate'

const PERMISSION = 'news.unpublish'

export const POST = route({
  method: 'POST',
  auth: 'required',
  permission: { key: PERMISSION },
  rateLimit: { bucket: 'news.unpublish', limit: 30, windowSeconds: 60 },
  body: { note: optional(string({ max: 500, trim: true })) },
  handle: async (input) => applyTransition({ input, to: 'UNPUBLISHED', permission: PERMISSION }),
})
