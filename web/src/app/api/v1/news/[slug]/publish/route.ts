/**
 * POST /api/v1/news/[slug]/publish -- put a story in front of readers (§12).
 *
 * Publishing is the moment a draft becomes something the public is told is
 * true, so it is the most audited write on the platform: one transaction
 * records the status, the version as it stood, and who did it (§43).
 */

import { applyTransition } from '@/lib/api/editorial'
import { route } from '@/lib/api/route'
import { optional, string } from '@/lib/api/validate'

const PERMISSION = 'news.publish'

export const POST = route({
  method: 'POST',
  auth: 'required',
  permission: { key: PERMISSION },
  rateLimit: { bucket: 'news.publish', limit: 30, windowSeconds: 60 },
  body: { note: optional(string({ max: 500, trim: true })) },
  handle: async (input) => applyTransition({ input, to: 'PUBLISHED', permission: PERMISSION }),
})
