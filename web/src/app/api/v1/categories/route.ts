/**
 * GET /api/v1/categories -- the taxonomy (§19).
 *
 * Reference data: small, public, and changing rarely. It still carries
 * `no-store` like every other API response, because the pipeline sets that
 * header uniformly and an exception would have to be justified per route
 * rather than assumed. Edge caching for reference data belongs with the CDN
 * work in §65, where it can be reasoned about once.
 */

import { listCategories } from '@/lib/db/repository'
import { route } from '@/lib/api/route'

export const GET = route({
  method: 'GET',
  rateLimit: { bucket: 'reference.categories', limit: 120, windowSeconds: 60 },
  handle: async ({ ctx }) => ({ data: { items: await listCategories(ctx.db) } }),
})
