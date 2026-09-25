/**
 * GET /api/v1/cities -- the location index (§22).
 *
 * Flat for now. §22's hierarchy is country → state → district → city →
 * locality, and the schema already models country and state; districts and
 * localities arrive with the location work rather than being faked here with a
 * shape the database cannot yet fill.
 */

import { listCities } from '@/lib/db/repository'
import { route } from '@/lib/api/route'

export const GET = route({
  method: 'GET',
  rateLimit: { bucket: 'reference.cities', limit: 120, windowSeconds: 60 },
  handle: async ({ ctx }) => ({ data: { items: await listCities(ctx.db) } }),
})
